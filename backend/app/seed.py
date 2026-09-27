import argparse
import random
import secrets
import string
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.auth import get_password_hash
from app.db import SessionLocal
from app.models import (
    Aspect,
    Feedback,
    FeedbackKind,
    FeedbackStatus,
    Issue,
    IssueEvent,
    IssueStatus,
    Location,
    User,
    UserRole,
    Verification,
)
from app.services.lifecycle import rescore_issues
from app.services.priority import calculate_priority_score

DEMO_PASSWORD = "demo1234"


def generate_code(existing_codes: set, length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    while True:
        c = "".join(secrets.choice(alphabet) for _ in range(length))
        if c not in existing_codes:
            existing_codes.add(c)
            return c


def reset_database(db: Session):
    print("Resetting database (deleting existing rows in FK-safe order)...")
    db.query(Verification).delete()
    db.query(IssueEvent).delete()
    db.query(Aspect).delete()
    db.query(Feedback).delete()
    db.query(Issue).delete()
    db.query(Location).delete()
    db.query(User).delete()
    db.commit()
    print("Database reset complete.")


DEMO_TRACKING_CODE = "DEMO"  # the Track page shows it as ECH-DEMO
DEMO_ISSUE_TITLE = "Mess Entrance Water Cooler Leakage"


def ensure_demo_report(db: Session):
    """Adds a report with a fixed tracking code to a resolved issue, so the Track page's "Try ECH-DEMO"
    link always opens the did-it-get-fixed screen. Safe to run repeatedly."""
    if db.query(Feedback).filter(Feedback.tracking_code == DEMO_TRACKING_CODE).first():
        print("Demo report ECH-DEMO already exists.")
        return

    resolved = db.query(Issue).filter(Issue.status == IssueStatus.resolved, Issue.resolved_at.isnot(None))
    issue = resolved.filter(Issue.title == DEMO_ISSUE_TITLE).first() or resolved.order_by(Issue.resolved_at).first()
    if not issue:
        print("No resolved issue to attach the demo report to; skipped ECH-DEMO.")
        return

    # Filed before the fix, so it's allowed to verify it
    created_at = max(issue.created_at, issue.resolved_at - timedelta(days=1)) if issue.created_at else issue.resolved_at - timedelta(days=1)
    text = f"{issue.title} — please look into it."
    fb = Feedback(
        kind=FeedbackKind.text,
        text_redacted=text,
        location_id=issue.location_id,
        tracking_code=DEMO_TRACKING_CODE,
        status=FeedbackStatus.approved,
        overall_sentiment="negative",
        analyzed_by="llm",
        created_at=created_at,
    )
    db.add(fb)
    db.flush()
    db.add(
        Aspect(
            feedback_id=fb.id,
            aspect=issue.category,
            category=issue.category,
            sentiment="negative",
            urgency="normal",
            evidence_span=issue.title,
            issue_id=issue.id,
        )
    )
    rescore_issues(db, {issue.id})
    db.commit()
    print(f"Demo report ECH-DEMO added to resolved issue: {issue.title}")


def seed_data(reset: bool = False):
    db: Session = SessionLocal()
    try:
        if reset:
            reset_database(db)

        if db.query(User).first():
            print("Database already contains data. Use --reset flag to reseed.")
            return

        print("Starting data seeding process...")

        # 1. Create Users
        hashed_password = get_password_hash(DEMO_PASSWORD)

        admin1 = User(
            name="Aditi Admin",
            email="admin@echo.edu",
            password_hash=hashed_password,
            role=UserRole.admin,
            team="Central Admin",
        )
        admin2 = User(
            name="Super Admin",
            email="admin2@echo.edu",
            password_hash=hashed_password,
            role=UserRole.admin,
            team="System Operations",
        )

        staff_wifi = User(
            name="Rahul Sharma",
            email="rahul.wifi@echo.edu",
            password_hash=hashed_password,
            role=UserRole.staff,
            team="IT/Wi-Fi Team",
        )
        staff_mess = User(
            name="Priya Patel",
            email="priya.mess@echo.edu",
            password_hash=hashed_password,
            role=UserRole.staff,
            team="Mess Team",
        )
        staff_hostel = User(
            name="Amit Kumar",
            email="amit.hostel@echo.edu",
            password_hash=hashed_password,
            role=UserRole.staff,
            team="Hostel Team",
        )

        db.add_all([admin1, admin2, staff_wifi, staff_mess, staff_hostel])
        db.commit()
        for u in [admin1, admin2, staff_wifi, staff_mess, staff_hostel]:
            db.refresh(u)
        print("Users created.")

        # 2. Create Locations
        locations_data = [
            {"name": "Central Mess", "slug": "central-mess", "zone": "North Campus"},
            {"name": "Aryabhata Hostel", "slug": "aryabhata-hostel", "zone": "Hostel Area"},
            {"name": "Bhaskara Hostel", "slug": "bhaskara-hostel", "zone": "Hostel Area"},
            {"name": "Central Library", "slug": "central-library", "zone": "Academic Block"},
            {"name": "Computer Center & IT Lab", "slug": "it-lab", "zone": "Academic Block"},
            {"name": "Campus Shuttle Stop", "slug": "shuttle-stop", "zone": "South Gate"},
        ]

        loc_objs = {}
        for l_data in locations_data:
            loc = Location(**l_data)
            db.add(loc)
            loc_objs[l_data["slug"]] = loc
        db.commit()
        for k in loc_objs:
            db.refresh(loc_objs[k])
        print("Locations created.")

        used_codes = set()
        now = datetime.now(timezone.utc)

        # 3. Create ~375 general feedback & aspect entries in batch
        categories = ["mess", "hostel", "infrastructure", "transport", "library", "academics", "general"]
        all_locs = list(loc_objs.values())

        feedback_templates = [
            ("The food in the mess was fresh today.", "positive", "normal", "food"),
            ("Wi-Fi coverage is good in the study room.", "positive", "normal", "Wi-Fi"),
            ("Clean washrooms in the library building.", "positive", "normal", "cleanliness"),
            ("Shuttle buses are running right on schedule.", "positive", "normal", "shuttle bus"),
            ("Great book collection added to reading section.", "positive", "normal", "books"),
            ("AC cooling is adequate in the main hall.", "positive", "normal", "air conditioning"),
            ("Staff behavior was very helpful today.", "positive", "normal", "staff behavior"),
            ("Average meal served at lunch time.", "neutral", "normal", "meal quality"),
            ("Shuttle frequency is acceptable during rush hours.", "neutral", "normal", "shuttle timing"),
            ("Library seats fill up quickly by noon.", "neutral", "normal", "seating capacity"),
            ("Water dispenser flow is slightly slow.", "neutral", "normal", "water dispenser"),
            ("Night canteen menu has limited options.", "neutral", "normal", "canteen menu"),
            ("Long queue at mess counter during breakfast.", "negative", "high", "counter queue"),
            ("Dustbins in corridor need emptying.", "negative", "normal", "dustbins"),
            ("Noise level in silent study room is annoying.", "negative", "normal", "noise level"),
            ("Buses get crowded around 5 PM.", "negative", "normal", "bus crowd"),
        ]

        print("Generating ~400 general feedback entries in bulk...")
        feedbacks_to_add = []
        aspects_to_add = []

        for i in range(375):
            days_ago = random.uniform(0.1, 42.0)
            created_dt = now - timedelta(days=days_ago)

            loc = random.choice(all_locs)
            cat = random.choice(categories)
            tmpl = random.choice(feedback_templates)

            code = generate_code(used_codes)

            fb = Feedback(
                kind=FeedbackKind.text,
                text_redacted=tmpl[0],
                location_id=loc.id,
                tracking_code=code,
                status=FeedbackStatus.approved,
                overall_sentiment=tmpl[1],
                analyzed_by="lexicon",
                flags=[],
                created_at=created_dt,
            )
            feedbacks_to_add.append((fb, cat, tmpl[1], tmpl[2], tmpl[3], tmpl[0][:50]))

        # Add baseline Wi-Fi complaints at Aryabhata Hostel (previous 28 days)
        aryabhata_loc = loc_objs["aryabhata-hostel"]
        for i in range(3):
            days_ago = random.uniform(4.0, 25.0)
            created_dt = now - timedelta(days=days_ago)
            code = generate_code(used_codes)

            fb = Feedback(
                kind=FeedbackKind.text,
                text_redacted="Wi-Fi connection drops occasionally in the evening.",
                location_id=aryabhata_loc.id,
                tracking_code=code,
                status=FeedbackStatus.approved,
                overall_sentiment="negative",
                analyzed_by="lexicon",
                flags=[],
                created_at=created_dt,
            )
            feedbacks_to_add.append((fb, "infrastructure", "negative", "high", "Wi-Fi disconnections", "Wi-Fi connection drops occasionally"))

        # Batch add all feedback rows
        fb_objects = [item[0] for item in feedbacks_to_add]
        db.add_all(fb_objects)
        db.flush()

        for fb_obj, cat, sent, urg, asp_text, ev_span in feedbacks_to_add:
            aspect = Aspect(
                feedback_id=fb_obj.id,
                aspect=asp_text,
                category=cat,
                sentiment=sent,
                urgency=urg,
                evidence_span=ev_span,
            )
            aspects_to_add.append(aspect)

        db.add_all(aspects_to_add)
        db.commit()
        print("General feedback batch seeded successfully.")

        # 4. Planted Spike: 20 negative Wi-Fi complaints at Aryabhata Hostel in last 3 days
        print("Planting Wi-Fi negative feedback spike at Aryabhata Hostel...")
        wifi_texts = [
            "Wi-Fi is completely down in B-Block since morning!",
            "Unable to connect to campus Wi-Fi for online submission.",
            "Frequent Wi-Fi packet drops making lectures unwatchable.",
            "Aryabhata Hostel Wi-Fi signal strength is extremely weak.",
            "Wi-Fi keeps disconnecting every 2 minutes in Room 304.",
            "No internet access via Wi-Fi in the entire hostel wing.",
            "Wi-Fi latency is over 500ms, completely unusable.",
            "Hostel Wi-Fi router seems offline on 2nd floor.",
            "Constant Wi-Fi authentication timeouts since yesterday.",
            "Wi-Fi network disappears every few minutes.",
        ]

        wifi_feedbacks = []
        wifi_aspects = []

        for i in range(20):
            hours_ago = random.uniform(1.0, 70.0)
            created_dt = now - timedelta(hours=hours_ago)
            code = generate_code(used_codes)
            txt = wifi_texts[i % len(wifi_texts)]

            fb = Feedback(
                kind=FeedbackKind.text,
                text_redacted=txt,
                location_id=aryabhata_loc.id,
                tracking_code=code,
                status=FeedbackStatus.approved,
                overall_sentiment="negative",
                analyzed_by="llm",
                flags=[],
                created_at=created_dt,
            )
            wifi_feedbacks.append((fb, txt, "critical" if i % 2 == 0 else "high"))

        db.add_all([item[0] for item in wifi_feedbacks])
        db.flush()

        for fb_obj, txt, urg in wifi_feedbacks:
            aspect = Aspect(
                feedback_id=fb_obj.id,
                aspect="Wi-Fi disconnection",
                category="infrastructure",
                sentiment="negative",
                urgency=urg,
                evidence_span=txt[:50],
            )
            wifi_aspects.append(aspect)

        db.add_all(wifi_aspects)
        db.commit()

        # Create ONE clustered issue for the Wi-Fi spike
        wifi_issue = Issue(
            title="Severe Wi-Fi Disconnections in Aryabhata Hostel",
            category="infrastructure",
            location_id=aryabhata_loc.id,
            assignee_id=staff_wifi.id,
            status=IssueStatus.in_progress,
            priority_score=18.5,
            created_at=now - timedelta(hours=48),
        )
        db.add(wifi_issue)
        db.flush()

        for asp in wifi_aspects:
            asp.issue_id = wifi_issue.id

        reports_data = [
            {"created_at": fb_obj.created_at, "sentiment": "negative"}
            for fb_obj, _, _ in wifi_feedbacks
        ]
        pri_res = calculate_priority_score(reports_data, highest_urgency="critical")
        wifi_issue.priority_score = pri_res.priority_score

        db.add(
            IssueEvent(
                issue_id=wifi_issue.id,
                from_status="open",
                to_status="in_progress",
                actor_id=staff_wifi.id,
                note="Investigating network switch and Access Point on 2nd/3rd floor.",
                created_at=now - timedelta(hours=24),
            )
        )
        db.commit()
        db.refresh(wifi_issue)

        # 5. Planted Issue 1: Fully Resolved Issue (Stays Resolved)
        mess_loc = loc_objs["central-mess"]
        resolved_code1 = generate_code(used_codes)

        resolved_fb = Feedback(
            kind=FeedbackKind.text,
            text_redacted="Water cooler near mess entrance is leaking continuously.",
            location_id=mess_loc.id,
            tracking_code=resolved_code1,
            status=FeedbackStatus.approved,
            overall_sentiment="negative",
            analyzed_by="llm",
            created_at=now - timedelta(days=10),
        )
        db.add(resolved_fb)
        db.flush()

        resolved_aspect = Aspect(
            feedback_id=resolved_fb.id,
            aspect="water cooler leak",
            category="mess",
            sentiment="negative",
            urgency="high",
            evidence_span="Water cooler near mess entrance is leaking",
        )
        db.add(resolved_aspect)
        db.flush()

        resolved_issue = Issue(
            title="Mess Entrance Water Cooler Leakage",
            category="mess",
            location_id=mess_loc.id,
            assignee_id=staff_mess.id,
            status=IssueStatus.resolved,
            public_response="The water cooler valve was replaced by maintenance team on Tuesday.",
            priority_score=4.0,
            created_at=now - timedelta(days=10),
            resolved_at=now - timedelta(days=4),
        )
        db.add(resolved_issue)
        db.flush()
        resolved_aspect.issue_id = resolved_issue.id

        db.add(
            IssueEvent(
                issue_id=resolved_issue.id,
                from_status="open",
                to_status="acknowledged",
                actor_id=staff_mess.id,
                note="Report received. Plumber assigned.",
                created_at=now - timedelta(days=9),
            )
        )
        db.add(
            IssueEvent(
                issue_id=resolved_issue.id,
                from_status="acknowledged",
                to_status="resolved",
                actor_id=staff_mess.id,
                note="Valve replaced. Leakage stopped.",
                created_at=now - timedelta(days=4),
            )
        )

        for v_idx in range(4):
            v_code = generate_code(used_codes)
            db.add(
                Verification(
                    issue_id=resolved_issue.id,
                    tracking_code=v_code,
                    fixed=True,
                    created_at=now - timedelta(days=3 - v_idx),
                )
            )

        db.commit()
        db.refresh(resolved_issue)

        # 6. Planted Issue 2: Reopened Issue (Reopened via Verification)
        library_loc = loc_objs["central-library"]
        reopened_code1 = generate_code(used_codes)

        reopened_fb = Feedback(
            kind=FeedbackKind.text,
            text_redacted="AC in Reading Room 2 is blowing warm air.",
            location_id=library_loc.id,
            tracking_code=reopened_code1,
            status=FeedbackStatus.approved,
            overall_sentiment="negative",
            analyzed_by="llm",
            created_at=now - timedelta(days=12),
        )
        db.add(reopened_fb)
        db.flush()

        reopened_aspect = Aspect(
            feedback_id=reopened_fb.id,
            aspect="AC cooling",
            category="library",
            sentiment="negative",
            urgency="high",
            evidence_span="AC in Reading Room 2 is blowing warm air",
        )
        db.add(reopened_aspect)
        db.flush()

        reopened_issue = Issue(
            title="Reading Room 2 AC Temperature Control",
            category="library",
            location_id=library_loc.id,
            assignee_id=staff_hostel.id,
            status=IssueStatus.reopened,
            reopened_count=1,
            public_response="AC thermostat recalibrated to 24C.",
            priority_score=6.5,
            created_at=now - timedelta(days=12),
            resolved_at=now - timedelta(days=6),
        )
        db.add(reopened_issue)
        db.flush()
        reopened_aspect.issue_id = reopened_issue.id

        db.add(
            IssueEvent(
                issue_id=reopened_issue.id,
                from_status="open",
                to_status="resolved",
                actor_id=staff_hostel.id,
                note="Thermostat recalibrated.",
                created_at=now - timedelta(days=6),
            )
        )
        db.add(
            IssueEvent(
                issue_id=reopened_issue.id,
                from_status="resolved",
                to_status="reopened",
                actor_id=None,
                note="Reopened automatically based on community verifications",
                created_at=now - timedelta(days=2),
            )
        )

        for v_idx, is_fixed in enumerate([False, False, True, True]):
            v_code = generate_code(used_codes)
            db.add(
                Verification(
                    issue_id=reopened_issue.id,
                    tracking_code=v_code,
                    fixed=is_fixed,
                    created_at=now - timedelta(days=5 - v_idx),
                )
            )

        db.commit()
        db.refresh(reopened_issue)

        ensure_demo_report(db)

        print("\n" + "=" * 65)
        print("                ECHO SYSTEM SEEDING COMPLETE                ")
        print("=" * 65)
        print("\n[USER CREDENTIALS] (Password for all: demo1234):")
        print(f"  * Admin 1:  admin@echo.edu       (Password: {DEMO_PASSWORD})")
        print(f"  * Admin 2:  admin2@echo.edu      (Password: {DEMO_PASSWORD})")
        print(f"  * Staff 1:  rahul.wifi@echo.edu  (Password: {DEMO_PASSWORD}) [IT/Wi-Fi]")
        print(f"  * Staff 2:  priya.mess@echo.edu  (Password: {DEMO_PASSWORD}) [Mess]")
        print(f"  * Staff 3:  amit.hostel@echo.edu (Password: {DEMO_PASSWORD}) [Hostel]")

        print("\n[KEY PLANTED DEMO ISSUES & CODES]:")
        print(f"  * Wi-Fi Spike Issue ID:  {wifi_issue.id}")
        print(f"    - Title:              {wifi_issue.title}")
        print(f"    - Priority Score:     {wifi_issue.priority_score}")
        print(f"  * Resolved Issue ID:    {resolved_issue.id}")
        print(f"    - Tracking Code:      {resolved_code1} (also ECH-DEMO)")
        print(f"  * Reopened Issue ID:    {reopened_issue.id}")
        print(f"    - Tracking Code:      {reopened_code1}")
        print("=" * 65 + "\n")

    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed database for Echo platform.")
    parser.add_argument("--reset", action="store_true", help="Delete all existing rows before seeding")
    parser.add_argument("--demo-report", action="store_true", help="Only add the ECH-DEMO report to an existing database")
    args = parser.parse_args()

    if args.demo_report:
        session = SessionLocal()
        try:
            ensure_demo_report(session)
        finally:
            session.close()
    else:
        seed_data(reset=args.reset)
