"""Cutover transform: migrate the existing single-tenant data into the tenancy
model (issue #82, ADR 0005/0006).

A one-shot data transform, run during a scheduled maintenance window, that lands
all existing single-tenant data under the founding Organisation **IWM Linz** and
wires up the tenancy spine around it. See ``birds/tests/test_cutover.py`` for the
behaviour this guarantees.
"""

from django.db import migrations

IWM_LINZ_HANDLE = "IWML"
IWM_LINZ_NAME = "IWM Linz"
# The legacy account that founds IWM Linz and becomes its Admin (ADR 0005).
ADMIN_USERNAME = "filip"
# The reserved Gelöschter-Nutzer sink (ADR 0003) is a global cross-tenant
# fallback, never an org-owned Beringer — it stays org-less through the cutover.
FALLBACK_BERINGER_HANDLE = "GELÖSCHT"
# Blank emails are backfilled with a deterministic, clearly-invalid placeholder
# (RFC 2606 ``.invalid`` TLD) so the address never routes mail and is obviously
# pending a real value. The username is never touched, so by-username login (ADR
# 0008) keeps working — only the previously-empty ``email`` field is filled.
PLACEHOLDER_EMAIL_DOMAIN = "iwm-linz.invalid"


def run_cutover(apps, schema_editor):
    Organization = apps.get_model("birds", "Organization")
    User = apps.get_model("auth", "User")
    Mitgliedschaft = apps.get_model("birds", "Mitgliedschaft")
    RingingStation = apps.get_model("birds", "RingingStation")
    Project = apps.get_model("birds", "Project")
    Scientist = apps.get_model("birds", "Scientist")
    DataEntry = apps.get_model("birds", "DataEntry")
    Ring = apps.get_model("birds", "Ring")

    # One-shot guard: act only when there is real single-tenant data to migrate.
    # A fresh database (test/dev) has nothing to cut over — leaving it untouched
    # keeps the migration a no-op there and avoids creating/dropping orgs on
    # every fresh migrate. The GELÖSCHT fallback alone does not count as data.
    has_data = (
        RingingStation.objects.exists()
        or DataEntry.objects.exists()
        or Ring.objects.exists()
        or Scientist.objects.exclude(handle=FALLBACK_BERINGER_HANDLE).exists()
    )
    if not has_data:
        return

    iwm, _ = Organization.objects.get_or_create(
        handle=IWM_LINZ_HANDLE,
        defaults={
            "name": IWM_LINZ_NAME,
            "country": "AT",
            "plan": "beta",
            "beta_cohort": True,
        },
    )

    # Land every Organisation-owned row under IWM Linz, regardless of which
    # placeholder org (or none, for Beringer) it currently carries. The reserved
    # GELÖSCHT fallback is the one Beringer that stays org-less.
    RingingStation.objects.update(organization=iwm)
    Project.objects.update(organization=iwm)
    Scientist.objects.exclude(handle=FALLBACK_BERINGER_HANDLE).update(organization=iwm)
    DataEntry.objects.update(organization=iwm)
    Ring.objects.update(organization=iwm)

    # filip founds IWM Linz as its Admin; every other account joins as a plain
    # Mitglied. Memberships are idempotent so a re-run never duplicates them.
    for account in User.objects.all():
        if not account.email:
            account.email = f"{account.username}@{PLACEHOLDER_EMAIL_DOMAIN}"
            account.save(update_fields=["email"])

        is_admin = account.username.lower() == ADMIN_USERNAME
        Mitgliedschaft.objects.update_or_create(
            user=account,
            organization=iwm,
            defaults={"rolle": "admin" if is_admin else "mitglied"},
        )

    # Raise the Seat-Limit so it fits every Mitgliedschaft (each consumes one
    # Mitgliedsplatz, ADR 0005); never lower it below the model default.
    seats_needed = Mitgliedschaft.objects.filter(organization=iwm).count()
    if iwm.seat_limit < seats_needed:
        iwm.seat_limit = seats_needed
        iwm.save(update_fields=["seat_limit"])

    # Drop the now-empty placeholder org(s) (e.g. the AUW seed from 0016): every
    # tenant row and Mitgliedschaft has moved to IWM Linz, leaving one tenant.
    Organization.objects.exclude(pk=iwm.pk).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0048_zugangscode"),
    ]

    operations = [
        migrations.RunPython(run_cutover, migrations.RunPython.noop),
    ]
