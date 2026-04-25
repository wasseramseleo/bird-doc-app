from datetime import timedelta

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from birds.models import DataEntry, Ring, RingingStation, Scientist, Species

SPECIES_DATA = [
    {
        "common_name_de": "Kohlmeise",
        "common_name_en": "Great Tit",
        "scientific_name": "Parus major",
        "family_name": "Paridae",
        "order_name": "Passeriformes",
        "ring_size": "V",
    },
    {
        "common_name_de": "Blaumeise",
        "common_name_en": "Eurasian Blue Tit",
        "scientific_name": "Cyanistes caeruleus",
        "family_name": "Paridae",
        "order_name": "Passeriformes",
        "ring_size": "V",
    },
    {
        "common_name_de": "Buchfink",
        "common_name_en": "Common Chaffinch",
        "scientific_name": "Fringilla coelebs",
        "family_name": "Fringillidae",
        "order_name": "Passeriformes",
        "ring_size": "S",
    },
    {
        "common_name_de": "Amsel",
        "common_name_en": "Common Blackbird",
        "scientific_name": "Turdus merula",
        "family_name": "Turdidae",
        "order_name": "Passeriformes",
        "ring_size": "T",
    },
    {
        "common_name_de": "Feldsperling",
        "common_name_en": "Eurasian Tree Sparrow",
        "scientific_name": "Passer montanus",
        "family_name": "Passeridae",
        "order_name": "Passeriformes",
        "ring_size": "V",
    },
]

# Each entry: (species_index, ring_number_str, date_offset_days, field_overrides)
# species_index references SPECIES_DATA; ring uses that species' ring_size.
ENTRY_SPECS = [
    (0, "1", 0, {
        "age_class": 3, "sex": 1, "bird_status": "e",
        "weight_gram": "15.50", "wing_span": "72.30", "feather_span": "66.10",
        "tarsus": "17.50", "fat_deposit": 2, "muscle_class": 1,
        "small_feather_int": 0, "small_feather_app": "N", "hand_wing": 0,
        "net_location": 3, "net_height": 2, "net_direction": "L",
        "has_mites": True,
    }),
    (0, "2", 2, {
        "age_class": 2, "sex": 2, "bird_status": "e",
        "weight_gram": "14.80", "wing_span": "70.10", "feather_span": "64.50",
        "tarsus": "17.20", "fat_deposit": 1, "muscle_class": 0,
        "small_feather_int": 1, "small_feather_app": "U", "hand_wing": 1,
        "net_location": 1, "net_height": 1, "net_direction": "R",
        "has_hunger_stripes": True,
    }),
    (0, "3", 4, {
        "age_class": 4, "sex": 0, "bird_status": "w",
        "weight_gram": "16.20", "fat_deposit": 3, "muscle_class": 2,
        "small_feather_int": 2, "small_feather_app": "M", "hand_wing": 2,
        "comment": "Wiederfang mit alter Beringung",
    }),
    (1, "4", 6, {
        "age_class": 3, "sex": 1, "bird_status": "e",
        "weight_gram": "11.30", "wing_span": "63.40", "feather_span": "58.20",
        "tarsus": "15.80", "fat_deposit": 0, "muscle_class": 1,
        "small_feather_int": 0, "small_feather_app": "J", "hand_wing": 0,
        "net_location": 2,
    }),
    (1, "5", 8, {
        "age_class": 5, "sex": 2, "bird_status": "e",
        "weight_gram": "12.10", "wing_span": "65.00",
        "fat_deposit": 2, "muscle_class": 2,
        "small_feather_int": 1, "small_feather_app": "N", "hand_wing": 3,
        "has_brood_patch": True,
    }),
    (1, "6", 10, {
        "age_class": 6, "sex": 0, "bird_status": "e",
        "weight_gram": "11.80",
        "small_feather_int": 2, "small_feather_app": "M", "hand_wing": 4,
    }),
    (2, "7", 12, {
        "age_class": 3, "sex": 1, "bird_status": "e",
        "weight_gram": "21.50", "wing_span": "90.20", "feather_span": "83.00",
        "tarsus": "19.30", "notch_f2": "5.20", "fat_deposit": 1, "muscle_class": 1,
        "small_feather_int": 0, "small_feather_app": "N", "hand_wing": 0,
        "net_location": 4, "net_height": 3, "net_direction": "L",
    }),
    (2, "8", 14, {
        "age_class": 2, "sex": 2, "bird_status": "e",
        "weight_gram": "22.00", "wing_span": "91.50",
        "fat_deposit": 3, "muscle_class": 3,
        "small_feather_int": 1, "small_feather_app": "U", "hand_wing": 1,
        "has_mites": True, "has_hunger_stripes": True,
        "comment": "Sehr mageres Tier",
    }),
    (2, "9", 16, {
        "age_class": 4, "sex": 1, "bird_status": "w",
    }),
    (3, "10", 18, {
        "age_class": 3, "sex": 2, "bird_status": "e",
        "weight_gram": "98.30", "wing_span": "138.50", "feather_span": "130.10",
        "tarsus": "31.20", "fat_deposit": 2, "muscle_class": 2,
        "small_feather_int": 0, "small_feather_app": "N", "hand_wing": 0,
        "net_location": 1, "net_height": 1, "net_direction": "R",
        "has_brood_patch": True,
    }),
    (3, "11", 20, {
        "age_class": 5, "sex": 1, "bird_status": "e",
        "weight_gram": "102.00", "wing_span": "141.20",
        "fat_deposit": 4, "muscle_class": 1,
        "small_feather_int": 2, "small_feather_app": "M", "hand_wing": 4,
    }),
    (3, "12", 22, {
        "age_class": 1, "sex": 0, "bird_status": "e",
        "weight_gram": "85.50",
        "comment": "Nestling, noch nicht flügge",
    }),
    (4, "13", 24, {
        "age_class": 3, "sex": 1, "bird_status": "e",
        "weight_gram": "22.30", "wing_span": "73.10", "feather_span": "67.50",
        "tarsus": "16.40", "fat_deposit": 1, "muscle_class": 1,
        "small_feather_int": 0, "small_feather_app": "J", "hand_wing": 0,
        "net_location": 5, "net_height": 1, "net_direction": "L",
        "has_cpl_plus": True,
    }),
    (4, "14", 26, {
        "age_class": 4, "sex": 2, "bird_status": "e",
        "weight_gram": "23.80", "wing_span": "74.00",
        "fat_deposit": 2, "muscle_class": 2,
        "small_feather_int": 1, "small_feather_app": "U", "hand_wing": 2,
        "has_mites": True, "has_cpl_plus": True,
    }),
    (4, "15", 28, {
        "age_class": 6, "sex": 0, "bird_status": "w",
        "fat_deposit": 0, "muscle_class": 0,
        "comment": "Wiederfang, kein Gewicht gemessen",
    }),
]


class Command(BaseCommand):
    help = "Populate the database with realistic test data for development."

    def handle(self, *args, **options):
        station, _ = RingingStation.objects.get_or_create(
            handle="TEST",
            defaults={"name": "Teststation"},
        )
        self.stdout.write("Ensured ringing station.")

        user, created = User.objects.get_or_create(
            username="testuser",
            defaults={
                "first_name": "Test",
                "last_name": "Beringer",
                "is_staff": True,
                "is_superuser": True,
            },
        )
        if created:
            user.set_password("test1234")
            user.save()

        scientist, _ = Scientist.objects.get_or_create(
            user=user,
            defaults={"handle": "TB"},
        )
        self.stdout.write(f"Ensured scientist '{scientist.handle}' (login: testuser / test1234).")

        species_objects = []
        for data in SPECIES_DATA:
            obj, _ = Species.objects.get_or_create(
                scientific_name=data["scientific_name"],
                defaults={k: v for k, v in data.items() if k != "scientific_name"},
            )
            species_objects.append(obj)
        self.stdout.write(f"Ensured {len(species_objects)} species.")

        now = timezone.now()
        created_count = 0

        for species_idx, ring_number, day_offset, overrides in ENTRY_SPECS:
            species = species_objects[species_idx]
            ring_size = species.ring_size or "V"

            ring, _ = Ring.objects.get_or_create(
                size=ring_size,
                number=ring_number,
            )

            if DataEntry.objects.filter(ring=ring).exists():
                continue

            DataEntry.objects.create(
                species=species,
                ring=ring,
                staff=scientist,
                ringing_station=station,
                date_time=now - timedelta(days=day_offset),
                **overrides,
            )
            created_count += 1

        self.stdout.write(f"Created {created_count} data entries.")
