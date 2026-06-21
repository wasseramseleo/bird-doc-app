"""Seed data needed to audit the frontend §8 acceptance criteria.

This command is idempotent (get_or_create throughout). It builds on top of
`create_test_data` (species / station / baseline entries) and adds the things
that command does not provide:

* links the `claude` superuser to a Scientist (the home/project endpoint needs
  `request.user.scientist`),
* a non-staff user (`viewer`) also linked to a Scientist + projects, so the
  conditional "Administration" link (AC-IA-5.1) can be checked,
* >= 3 Organizations + >= 3 Projects (home list / cascade),
* a recapture ring (V 100) referenced by 2 DataEntry rows so the recapture
  history + status chips render (AC-IA-3.1, AC-MO-4.1).
"""

from datetime import timedelta

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from birds.models import (
    DataEntry,
    Organization,
    Project,
    Ring,
    RingingStation,
    Scientist,
    Species,
)

ORGS = [
    ("AOC", "Austrian Ornithological Centre"),
    ("VWH", "Vogelwarte Hohenau"),
    ("NPD", "Nationalpark Donau-Auen"),
]

PROJECTS = [
    (
        "Beringung Hohenau 2024",
        "AOC",
        "Standardisierte Fang- und Beringungsaktion an der March bei Hohenau. "
        "Schwerpunkt Kleinvögel im Schilfgürtel; läuft von März bis Oktober mit "
        "wöchentlichen Fangtagen und vollständiger Biometrie.",
    ),
    ("Wintergäste Donau-Auen", "NPD", "Erfassung überwinternder Singvögel."),
    ("Zugvogelmonitoring March", "VWH", ""),
]


class Command(BaseCommand):
    help = "Seed projects, a recapture ring and user links for the frontend audit."

    def handle(self, *args, **options):
        now = timezone.now()

        # --- Users + scientists ---------------------------------------------
        claude = User.objects.filter(username="claude").first()
        if claude is None:
            self.stderr.write(
                "No 'claude' superuser found. Create it first "
                "(manage.py createsuperuser) then re-run."
            )
            return

        claude_sci, _ = Scientist.objects.get_or_create(
            user=claude, defaults={"handle": "CL"}
        )

        viewer, created = User.objects.get_or_create(
            username="viewer",
            defaults={
                "first_name": "Vera",
                "last_name": "Beobachter",
                "is_staff": False,
                "is_superuser": False,
            },
        )
        if created:
            viewer.set_password("viewer")
            viewer.save()
        viewer_sci, _ = Scientist.objects.get_or_create(
            user=viewer, defaults={"handle": "VB"}
        )

        # --- Organizations ---------------------------------------------------
        orgs = {}
        for handle, name in ORGS:
            org, _ = Organization.objects.get_or_create(
                handle=handle, defaults={"name": name, "country": "AT"}
            )
            orgs[handle] = org

        # --- Ringing station under an org (create_test_data's TEST has none) -
        station, _ = RingingStation.objects.get_or_create(
            handle="HOHENAU",
            defaults={"name": "Station Hohenau", "organization": orgs["AOC"]},
        )

        # --- Projects --------------------------------------------------------
        projects = {}
        for title, org_handle, description in PROJECTS:
            project, _ = Project.objects.get_or_create(
                title=title,
                defaults={
                    "organization": orgs[org_handle],
                    "description": description,
                },
            )
            project.scientists.add(claude_sci, viewer_sci)
            projects[title] = project

        main_project = projects["Beringung Hohenau 2024"]

        # --- Species ---------------------------------------------------------
        species = (
            Species.objects.filter(common_name_de="Kohlmeise").first()
            or Species.objects.first()
        )
        if species is None:
            self.stderr.write(
                "No species found. Run 'manage.py migrate' and "
                "'manage.py create_test_data' first."
            )
            return

        # --- Recapture ring: V 100 with two captures -------------------------
        recap_ring, _ = Ring.objects.get_or_create(size="V", number="100")
        if not DataEntry.objects.filter(ring=recap_ring).exists():
            DataEntry.objects.create(
                species=species,
                ring=recap_ring,
                staff=claude_sci,
                ringing_station=station,
                project=main_project,
                date_time=now - timedelta(days=40),
                bird_status="e",
                age_class=3,
                sex=1,
                weight_gram="15.30",
                wing_span="71.00",
                fat_deposit=2,
                muscle_class=1,
                comment="Erstfang",
            )
            DataEntry.objects.create(
                species=species,
                ring=recap_ring,
                staff=claude_sci,
                ringing_station=station,
                project=main_project,
                date_time=now - timedelta(days=5),
                bird_status="w",
                age_class=5,
                sex=1,
                weight_gram="16.10",
                wing_span="71.50",
                fat_deposit=3,
                muscle_class=2,
                comment="Wiederfang desselben Rings",
            )

        # --- Give existing project-less entries a home -----------------------
        attached = DataEntry.objects.filter(project__isnull=True).update(
            project=main_project
        )

        self.stdout.write(
            self.style.SUCCESS(
                "Audit data ready.\n"
                f"  Staff login:     claude / claude  (scientist {claude_sci.handle})\n"
                f"  Non-staff login: viewer / viewer  (scientist {viewer_sci.handle})\n"
                f"  Organizations:   {Organization.objects.count()}\n"
                f"  Projects:        {Project.objects.count()} "
                f"(claude is on {claude_sci.projects.count()})\n"
                f"  Recapture ring:  V 100 "
                f"({DataEntry.objects.filter(ring=recap_ring).count()} captures)\n"
                f"  Entries attached to '{main_project.title}': {attached}"
            )
        )
