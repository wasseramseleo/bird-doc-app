"""Seed the 58 net-new globale Standard-Artennormen (PRD #260, issue #262, ADR 0021).

Additive follow-up to ``0060_seed_species_norms`` (the original 11). This migration
seeds the **58 net-new** globale Standard-Artennormen (the ``organization = NULL``
layer) so every Organisation immediately gets working Plausibilitätswarnungen for
these species too — same 1.96 SD-Faktor and 3 % Quotient-Toleranz as the 11.

Following the ``0060`` / ``0022_seed_austrian_ring_sizes`` pattern, the Ø/SD values are
a **static dict literal embedded in this migration**, extracted at build time from the
finalized ``docs/Korrekturebenen.xlsx`` / ``docs/Korrekturebenen.csv`` (never read at
runtime), keyed by ``scientific_name`` and stored **verbatim** (store-as-is).

**Additive only.** The seed dict contains ONLY the 58 net-new species. The 11 already
seeded by ``0060`` — re-listed in the new sheet with identical values — are excluded,
so their rows (and the ``geschlechtsbestimmung_moeglich`` flags ``0060`` curated) are
never touched. The new sheet has no ``Geschlechtsbestimmung möglich`` column, so this
migration writes ``geschlechtsbestimmung_moeglich = None`` on every new row (backfilling
from the sheet would destroy that curation). The duplicated Haussperling sheet row is
moot: Haussperling is one of the excluded 11.

**German name → scientific_name crosswalk resolved at build time** against
``birds/migrations/artenliste_2024.csv`` (the exact source that seeds the Species table),
matching the sheet's ``Artname D`` against ``common_name_de``. 55 of 58 resolve directly;
**3 are hand-resolved** (the 6-letter Artkürzel is NOT a reliable taxonomy source — the
German-name crosswalk is authoritative):

    Grünling            → Chloris chloris
    Schwarzkehlchen     → Saxicola rubicola
    Halsbandschnäp(per) → Ficedula albicollis

All 58 are present in the Species seed (0 unmatched expected). ``Kerbe F2`` / ``Innenfuß``
ship null (no columns in the sheet), as do ``dj_grossgefiedermauser_moeglich`` and
``geschlechtsbestimmung_moeglich``. A species with no Tarsus in the sheet ships null
Tarsus bands (an absent band, not a wrong one). The sheet's ±SD factor is 1.96 and its
Quotient tolerance is 3 % on every row (stored once as the constants below, NOT the
per-column "SD"=1.96 / "+/- %"=95.00 columns, which are not stored per measurement).
"""

from decimal import Decimal

from django.db import migrations


def _d(value):
    return None if value is None else Decimal(value)


# scientific_name -> Ø/SD values, hard-coded from docs/Korrekturebenen.xlsx (the 58
# net-new species; the 11 seeded by 0060 are excluded). Each entry carries a
# ``# German name (Artkürzel)`` comment for reviewability. Values are stored verbatim.
SD_FACTOR = Decimal("1.96")
QUOTIENT_TOLERANCE_PCT = Decimal("3")


SPECIES_NORMS = {
    # Zaunkönig (trotro)
    "Troglodytes troglodytes": {
        "weight_mean": "9.1102", "weight_sd": "0.8136",
        "feather_mean": "36.6092", "feather_sd": "1.6585",
        "wing_mean": "48.9725", "wing_sd": "2.129",
        "quotient_mean": "0.7541",
        "tarsus_mean": None, "tarsus_sd": None,
    },
    # Sumpfrohrsänger (acrpal)
    "Acrocephalus palustris": {
        "weight_mean": "12.02525", "weight_sd": "1.119945",
        "feather_mean": "52.19424", "feather_sd": "1.58926",
        "wing_mean": "69.04217", "wing_sd": "5.197076",
        "quotient_mean": "0.7562001",
        "tarsus_mean": "22.01962", "tarsus_sd": "0.7734401",
    },
    # Schwanzmeise (aegcau)
    "Aegithalos caudatus": {
        "weight_mean": "7.927197", "weight_sd": "0.4489634",
        "feather_mean": "47.55728", "feather_sd": "1.380357",
        "wing_mean": "63.88205", "wing_sd": "1.780894",
        "quotient_mean": "0.7466572",
        "tarsus_mean": "16.53934", "tarsus_sd": "0.7920509",
    },
    # Eisvogel (alcatt)
    "Alcedo atthis": {
        "weight_mean": "38.1919", "weight_sd": "4.1748",
        "feather_mean": "55.786", "feather_sd": "1.7713",
        "wing_mean": "78.6281", "wing_sd": "1.5548",
        "quotient_mean": "0.7096",
        "tarsus_mean": "11.13235", "tarsus_sd": "1.645477",
    },
    # Baumpieper (anttri)
    "Anthus trivialis": {
        "weight_mean": "22.94855", "weight_sd": "3.864384",
        "feather_mean": "67.62164", "feather_sd": "2.371109",
        "wing_mean": "88.71371", "wing_sd": "2.809807",
        "quotient_mean": "0.7632633",
        "tarsus_mean": "21.08704", "tarsus_sd": "0.6280206",
    },
    # Stieglitz (carcar)
    "Carduelis carduelis": {
        "weight_mean": "16.55043", "weight_sd": "1.294503",
        "feather_mean": "61.73616", "feather_sd": "2.031439",
        "wing_mean": "80.73395", "wing_sd": "2.383198",
        "quotient_mean": "0.7646852",
        "tarsus_mean": "14.60743", "tarsus_sd": "1.043697",
    },
    # Grünling (carchl)  # hand-resolved German→scientific crosswalk
    "Chloris chloris": {
        "weight_mean": "26.31448", "weight_sd": "2.230747",
        "feather_mean": "66.67089", "feather_sd": "1.966516",
        "wing_mean": "88.00411", "wing_sd": "2.27481",
        "quotient_mean": "0.7576259",
        "tarsus_mean": "17.58017", "tarsus_sd": "1.805549",
    },
    # Kernbeißer (coccoc)
    "Coccothraustes coccothraustes": {
        "weight_mean": "52.59559", "weight_sd": "3.973172",
        "feather_mean": "77.414", "feather_sd": "2.184081",
        "wing_mean": "103.9621", "wing_sd": "3.108686",
        "quotient_mean": "0.7470802",
        "tarsus_mean": "21.26324", "tarsus_sd": "0.8609097",
    },
    # Mehlschwalbe (delurb)
    "Delichon urbicum": {
        "weight_mean": "16.21667", "weight_sd": "1.715464",
        "feather_mean": "83.55926", "feather_sd": "1.864292",
        "wing_mean": "111.1136", "wing_sd": "3.146925",
        "quotient_mean": "0.7540203",
        "tarsus_mean": "11.195", "tarsus_sd": "0.7037306",
    },
    # Buntspecht (denmaj)
    "Dendrocopos major": {
        "weight_mean": "74.09087", "weight_sd": "5.754166",
        "feather_mean": "100.6051", "feather_sd": "3.156261",
        "wing_mean": "132.5263", "wing_sd": "3.373116",
        "quotient_mean": "0.7591521",
        "tarsus_mean": "23.64023", "tarsus_sd": "0.9163212",
    },
    # Kleinspecht (denmin)
    "Dryobates minor": {
        "weight_mean": "20.40169", "weight_sd": "1.199572",
        "feather_mean": "69.03571", "feather_sd": "1.834956",
        "wing_mean": "89.67647", "wing_sd": "2.172792",
        "quotient_mean": "0.769448",
        "tarsus_mean": "14.49744", "tarsus_sd": "0.5758744",
    },
    # Goldammer (embcit)
    "Emberiza citrinella": {
        "weight_mean": "28.08366", "weight_sd": "2.116725",
        "feather_mean": "67.3474", "feather_sd": "2.800884",
        "wing_mean": "88.41075", "wing_sd": "3.237075",
        "quotient_mean": "0.7617428",
        "tarsus_mean": "19.43147", "tarsus_sd": "0.7656831",
    },
    # Rohrammer (embsch)
    "Emberiza schoeniclus": {
        "weight_mean": "19.28123", "weight_sd": "1.829363",
        "feather_mean": "59.65826", "feather_sd": "2.958613",
        "wing_mean": "78.60468", "wing_sd": "3.474922",
        "quotient_mean": "0.7591351",
        "tarsus_mean": "19.70504", "tarsus_sd": "0.7976812",
    },
    # Rotkehlchen (erirub)
    "Erithacus rubecula": {
        "weight_mean": "16.14751", "weight_sd": "1.404185",
        "feather_mean": "53.85954", "feather_sd": "1.628479",
        "wing_mean": "72.66344", "wing_sd": "1.889757",
        "quotient_mean": "0.7410921",
        "tarsus_mean": "24.76812", "tarsus_sd": "1.048223",
    },
    # Trauerschnäpper (fichyp)
    "Ficedula hypoleuca": {
        "weight_mean": "12.20204", "weight_sd": "1.163416",
        "feather_mean": "61.12766", "feather_sd": "1.718657",
        "wing_mean": "80", "wing_sd": "1.606672",
        "quotient_mean": "0.7620416",
        "tarsus_mean": "17.31304", "tarsus_sd": "0.5230716",
    },
    # Buchfink (fricoe)
    "Fringilla coelebs": {
        "weight_mean": "22.33644", "weight_sd": "2.105535",
        "feather_mean": "66.3587", "feather_sd": "2.904493",
        "wing_mean": "86.84762", "wing_sd": "3.439815",
        "quotient_mean": "0.7669854",
        "tarsus_mean": "18.03333", "tarsus_sd": "0.8869807",
    },
    # Gelbspötter (hipict)
    "Hippolais icterina": {
        "weight_mean": "12.69107", "weight_sd": "0.7398469",
        "feather_mean": "59.02941", "feather_sd": "1.653759",
        "wing_mean": "77.92857", "wing_sd": "1.949893",
        "quotient_mean": "0.7579402",
        "tarsus_mean": "20.29804", "tarsus_sd": "0.6136742",
    },
    # Rauchschwalbe (hirrus)
    "Hirundo rustica": {
        "weight_mean": "19.27611", "weight_sd": "1.720313",
        "feather_mean": "94.52471", "feather_sd": "3.238531",
        "wing_mean": "122.9435", "wing_sd": "3.135954",
        "quotient_mean": "0.7689183",
        "tarsus_mean": "11.20389", "tarsus_sd": "0.6404528",
    },
    # Wendehals (jyntor)
    "Jynx torquilla": {
        "weight_mean": "31.89789", "weight_sd": "3.700703",
        "feather_mean": "59.91911", "feather_sd": "4.242291",
        "wing_mean": "82.08675", "wing_sd": "4.716994",
        "quotient_mean": "0.7324593",
        "tarsus_mean": "19.62622", "tarsus_sd": "0.9946722",
    },
    # Raubwürger (lanexc)
    "Lanius excubitor": {
        "weight_mean": "65.44", "weight_sd": "11.70508",
        "feather_mean": "84.46296", "feather_sd": "1.883323",
        "wing_mean": "113.9907", "wing_sd": "2.159863",
        "quotient_mean": "0.7402106",
        "tarsus_mean": "26.77407", "tarsus_sd": "0.8200748",
    },
    # Schlagschwirl (locflu)
    "Locustella fluviatilis": {
        "weight_mean": "17.26667", "weight_sd": "1.921488",
        "feather_mean": "54.53493", "feather_sd": "2.215852",
        "wing_mean": "74.60777", "wing_sd": "2.868219",
        "quotient_mean": "0.7305956",
        "tarsus_mean": "21.33896", "tarsus_sd": "0.800623",
    },
    # Feldschwirl (locnae)
    "Locustella naevia": {
        "weight_mean": "13.1372", "weight_sd": "1.148733",
        "feather_mean": "48.87621", "feather_sd": "1.416602",
        "wing_mean": "65.61927", "wing_sd": "1.775713",
        "quotient_mean": "0.7450864",
        "tarsus_mean": "19.79193", "tarsus_sd": "0.6504732",
    },
    # Blaukehlchen (lussve)
    "Luscinia svecica": {
        "weight_mean": "16.55071", "weight_sd": "1.362833",
        "feather_mean": "55.4086", "feather_sd": "1.967845",
        "wing_mean": "73.60587", "wing_sd": "2.63132",
        "quotient_mean": "0.7530835",
        "tarsus_mean": "25.78372", "tarsus_sd": "1.132766",
    },
    # Bienenfresser (merapi)
    "Merops apiaster": {
        "weight_mean": "52.59753", "weight_sd": "5.174132",
        "feather_mean": "105.506", "feather_sd": "6.129981",
        "wing_mean": "143.9281", "wing_sd": "5.698766",
        "quotient_mean": "0.7323819",
        "tarsus_mean": "12.25286", "tarsus_sd": "0.8762491",
    },
    # Bachstelze (motalb)
    "Motacilla alba": {
        "weight_mean": "21.1012", "weight_sd": "1.967016",
        "feather_mean": "67.29876", "feather_sd": "2.278066",
        "wing_mean": "88.71526", "wing_sd": "3.039428",
        "quotient_mean": "0.7567683",
        "tarsus_mean": "23.11758", "tarsus_sd": "0.7588292",
    },
    # Schafstelze (motfla)
    "Motacilla flava": {
        "weight_mean": "16.0922", "weight_sd": "1.205",
        "feather_mean": "61.0802", "feather_sd": "2.7275",
        "wing_mean": "81.2547", "wing_sd": "2.5259",
        "quotient_mean": "0.7512683",
        "tarsus_mean": "23.17772", "tarsus_sd": "0.857521",
    },
    # Grauschnäpper (musstr)
    "Muscicapa striata": {
        "weight_mean": "15.5289", "weight_sd": "1.5522",
        "feather_mean": "68.544", "feather_sd": "1.8795",
        "wing_mean": "89.3455", "wing_sd": "1.9003",
        "quotient_mean": "0.7628002",
        "tarsus_mean": "14.72069", "tarsus_sd": "0.5906288",
    },
    # Pirol (oriori)
    "Oriolus oriolus": {
        "weight_mean": "72.18361", "weight_sd": "5.707807",
        "feather_mean": "112.9912", "feather_sd": "2.97935",
        "wing_mean": "150.7456", "wing_sd": "3.456519",
        "quotient_mean": "0.7482813",
        "tarsus_mean": "21.97742", "tarsus_sd": "1.078618",
    },
    # Tannenmeise (parate)
    "Periparus ater": {
        "weight_mean": "9.2599", "weight_sd": "0.6262",
        "feather_mean": "47.8439", "feather_sd": "1.9547",
        "wing_mean": "62.3056", "wing_sd": "2.3342",
        "quotient_mean": "0.7679",
        "tarsus_mean": "16.43571", "tarsus_sd": "0.6464801",
    },
    # Blaumeise (parcae)
    "Cyanistes caeruleus": {
        "weight_mean": "10.9283", "weight_sd": "0.6633",
        "feather_mean": "51.1487", "feather_sd": "1.6174",
        "wing_mean": "66.5328", "wing_sd": "2.2191",
        "quotient_mean": "0.771",
        "tarsus_mean": "16.50362", "tarsus_sd": "1.168861",
    },
    # Kohlmeise (parmaj)
    "Parus major": {
        "weight_mean": "17.35913", "weight_sd": "2.26843",
        "feather_mean": "57.17013", "feather_sd": "1.845595",
        "wing_mean": "75.98384", "wing_sd": "2.311891",
        "quotient_mean": "0.7536138",
        "tarsus_mean": "19.55082", "tarsus_sd": "0.7816898",
    },
    # Sumpfmeise (parpal)
    "Poecile palustris": {
        "weight_mean": "10.89853", "weight_sd": "0.6842564",
        "feather_mean": "48.62143", "feather_sd": "1.714577",
        "wing_mean": "65.25694", "wing_sd": "1.944644",
        "quotient_mean": "0.7432551",
        "tarsus_mean": "16.22121", "tarsus_sd": "1.408929",
    },
    # Feldsperling (pasmon)
    "Passer montanus": {
        "weight_mean": "21.86008", "weight_sd": "1.590181",
        "feather_mean": "51.4848", "feather_sd": "1.97383",
        "wing_mean": "68.82893", "wing_sd": "2.459702",
        "quotient_mean": "0.748316",
        "tarsus_mean": "17.17152", "tarsus_sd": "0.9732569",
    },
    # Hausrotschwanz (phooch)
    "Phoenicurus ochruros": {
        "weight_mean": "15.23235", "weight_sd": "1.196135",
        "feather_mean": "64.43333", "feather_sd": "1.980004",
        "wing_mean": "84.29032", "wing_sd": "2.351504",
        "quotient_mean": "0.763696",
        "tarsus_mean": "22.72", "tarsus_sd": "0.787576",
    },
    # Gartenrotschwanz (phopho)
    "Phoenicurus phoenicurus": {
        "weight_mean": "14.92849", "weight_sd": "1.341639",
        "feather_mean": "60.94854", "feather_sd": "2.015568",
        "wing_mean": "80.25783", "wing_sd": "1.980794",
        "quotient_mean": "0.7592485",
        "tarsus_mean": "21.51988", "tarsus_sd": "0.7769575",
    },
    # Zilpzalp (phycol)
    "Phylloscopus collybita": {
        "weight_mean": "7.401999", "weight_sd": "0.7332515",
        "feather_mean": "45.07795", "feather_sd": "2.447029",
        "wing_mean": "59.72174", "wing_sd": "3.097698",
        "quotient_mean": "0.7550629",
        "tarsus_mean": "18.97656", "tarsus_sd": "0.8302943",
    },
    # Fitis (phytro)
    "Phylloscopus trochilus": {
        "weight_mean": "8.660182", "weight_sd": "1.048958",
        "feather_mean": "50.09923", "feather_sd": "2.44018",
        "wing_mean": "66.64419", "wing_sd": "2.938025",
        "quotient_mean": "0.7518811",
        "tarsus_mean": "19.16013", "tarsus_sd": "0.8288573",
    },
    # Heckenbraunelle (prumod)
    "Prunella modularis": {
        "weight_mean": "19.85007", "weight_sd": "1.628641",
        "feather_mean": "51.79432", "feather_sd": "1.547194",
        "wing_mean": "69.37019", "wing_sd": "1.809147",
        "quotient_mean": "0.7464719",
        "tarsus_mean": "20.10273", "tarsus_sd": "0.7346592",
    },
    # Wintergoldhähnchen (regreg)
    "Regulus regulus": {
        "weight_mean": "5.561539", "weight_sd": "0.3100215",
        "feather_mean": "41.73846", "feather_sd": "1.6354",
        "wing_mean": "54.48611", "wing_sd": "1.514153",
        "quotient_mean": "0.7694479",
        "tarsus_mean": "16.75", "tarsus_sd": "0.5411828",
    },
    # Beutelmeise (rempen)
    "Remiz pendulinus": {
        "weight_mean": "9.2787", "weight_sd": "0.7361",
        "feather_mean": "42.4705", "feather_sd": "3.5053",
        "wing_mean": "57.2224", "wing_sd": "3.4781",
        "quotient_mean": "0.7459",
        "tarsus_mean": "14.09744", "tarsus_sd": "0.6478701",
    },
    # Uferschwalbe (riprip)
    "Riparia riparia": {
        "weight_mean": "12.8551", "weight_sd": "0.8913",
        "feather_mean": "81.8043", "feather_sd": "2.882",
        "wing_mean": "105.7826", "wing_sd": "12.1853",
        "quotient_mean": "0.8461",
        "tarsus_mean": "10.65229", "tarsus_sd": "0.5697115",
    },
    # Braunkehlchen (saxrub)
    "Saxicola rubetra": {
        "weight_mean": "16.5815", "weight_sd": "1.7932",
        "feather_mean": "58.1605", "feather_sd": "1.8906",
        "wing_mean": "77.6636", "wing_sd": "2.8172",
        "quotient_mean": "0.744",
        "tarsus_mean": "21.84966", "tarsus_sd": "0.7709233",
    },
    # Schwarzkehlchen (saxtor)  # hand-resolved German→scientific crosswalk
    "Saxicola rubicola": {
        "weight_mean": "14.08095", "weight_sd": "1.256159",
        "feather_mean": "49.26963", "feather_sd": "1.364068",
        "wing_mean": "66.28842", "wing_sd": "1.608935",
        "quotient_mean": "0.7428123",
        "tarsus_mean": "22.15094", "tarsus_sd": "0.6928137",
    },
    # Girlitz (serser)
    "Serinus serinus": {
        "weight_mean": "11.83007", "weight_sd": "0.8176161",
        "feather_mean": "55.29147", "feather_sd": "2.166567",
        "wing_mean": "72.46567", "wing_sd": "2.170259",
        "quotient_mean": "0.7630144",
        "tarsus_mean": "13.99042", "tarsus_sd": "0.6030246",
    },
    # Kleiber (siteur)
    "Sitta europaea": {
        "weight_mean": "22.025", "weight_sd": "1.40663",
        "feather_mean": "66.37447", "feather_sd": "2.028007",
        "wing_mean": "86.875", "wing_sd": "3.059576",
        "quotient_mean": "0.7658572",
        "tarsus_mean": "19.97742", "tarsus_sd": "0.5424351",
    },
    # Star (stuvul)
    "Sturnus vulgaris": {
        "weight_mean": "73.40224", "weight_sd": "6.080457",
        "feather_mean": "92.05559", "feather_sd": "4.245988",
        "wing_mean": "125.8717", "wing_sd": "4.415667",
        "quotient_mean": "0.7329722",
        "tarsus_mean": "28.92018", "tarsus_sd": "1.029372",
    },
    # Gartengrasmücke (sylbor)
    "Sylvia borin": {
        "weight_mean": "19.73144", "weight_sd": "1.980495",
        "feather_mean": "59.99772", "feather_sd": "1.718418",
        "wing_mean": "80.01346", "wing_sd": "1.948571",
        "quotient_mean": "0.7497222",
        "tarsus_mean": "20.06452", "tarsus_sd": "0.7052761",
    },
    # Dorngrasmücke (sylcom)
    "Curruca communis": {
        "weight_mean": "15.08024", "weight_sd": "1.730654",
        "feather_mean": "55.58109", "feather_sd": "1.640764",
        "wing_mean": "74.05021", "wing_sd": "1.819728",
        "quotient_mean": "0.7505512",
        "tarsus_mean": "21.28518", "tarsus_sd": "0.7457646",
    },
    # Klappergrasmücke (sylcur)
    "Curruca curruca": {
        "weight_mean": "12.03811", "weight_sd": "1.341174",
        "feather_mean": "50.05983", "feather_sd": "1.529232",
        "wing_mean": "66.56977", "wing_sd": "1.845648",
        "quotient_mean": "0.7516175",
        "tarsus_mean": "19.17054", "tarsus_sd": "0.9531763",
    },
    # Sperbergrasmücke (sylnis)
    "Curruca nisoria": {
        "weight_mean": "23.7316", "weight_sd": "2.2448",
        "feather_mean": "66.5", "feather_sd": "2.2945",
        "wing_mean": "89.0588", "wing_sd": "2.1343",
        "quotient_mean": "0.7466",
        "tarsus_mean": "23.90977", "tarsus_sd": "0.7954287",
    },
    # Amsel (turmer)
    "Turdus merula": {
        "weight_mean": "85.5965", "weight_sd": "11.3203",
        "feather_mean": "95.9448", "feather_sd": "5.6697",
        "wing_mean": "126.486", "wing_sd": "9.5485",
        "quotient_mean": "0.7765",
        "tarsus_mean": "32.78609", "tarsus_sd": "1.079659",
    },
    # Waldlaubsänger (physib)
    "Phylloscopus sibilatrix": {
        "weight_mean": "9.2375", "weight_sd": "0.8239",
        "feather_mean": "57.25", "feather_sd": "2.9347",
        "wing_mean": "74.5375", "wing_sd": "3.1373",
        "quotient_mean": "0.7681",
        "tarsus_mean": None, "tarsus_sd": None,
    },
    # Sommergoldhähnchen (regign)
    "Regulus ignicapilla": {
        "weight_mean": "5.5125", "weight_sd": "1.6464",
        "feather_mean": "40.6065", "feather_sd": "2.2577",
        "wing_mean": "53.1545", "wing_sd": "3.0449",
        "quotient_mean": "0.764",
        "tarsus_mean": None, "tarsus_sd": None,
    },
    # Bekassine (galgal) — SUSPECT source SD: feather_sd=68.1271 is implausibly
    # large. Shipped VERBATIM (not clamped); any correction happens source-side
    # in docs/Korrekturebenen.xlsx and is Out of Scope here.
    "Gallinago gallinago": {
        "weight_mean": "99.2463", "weight_sd": "10.8974",
        "feather_mean": "94.4276", "feather_sd": "68.1271",
        "wing_mean": "134.2975", "wing_sd": "10.5113",
        "quotient_mean": "0.7101",
        "tarsus_mean": None, "tarsus_sd": None,
    },
    # Erlenzeisig (carspi)
    "Spinus spinus": {
        "weight_mean": "11.3333", "weight_sd": "0.6046",
        "feather_mean": "56.125", "feather_sd": "1.5828",
        "wing_mean": "73.4583", "wing_sd": "2.0662",
        "quotient_mean": "0.7643",
        "tarsus_mean": None, "tarsus_sd": None,
    },
    # Gimpel (pyrpyr)
    "Pyrrhula pyrrhula": {
        "weight_mean": "28.6812", "weight_sd": "1.5766",
        "feather_mean": "71.1621", "feather_sd": "1.8607",
        "wing_mean": "92.0517", "wing_sd": "6.5907",
        "quotient_mean": "0.7826",
        "tarsus_mean": None, "tarsus_sd": None,
    },
    # Grünspecht (picvir) — SUSPECT source SDs: feather_sd=0.5449 / wing_sd=0.8165
    # are implausibly small. Shipped VERBATIM (not clamped); any correction happens
    # source-side in docs/Korrekturebenen.xlsx and is Out of Scope here.
    "Picus viridis": {
        "weight_mean": "171.625", "weight_sd": "11.248",
        "feather_mean": "120.125", "feather_sd": "0.5449",
        "wing_mean": "160", "wing_sd": "0.8165",
        "quotient_mean": "0.7511",
        "tarsus_mean": None, "tarsus_sd": None,
    },
    # Halsbandschnäp (ficalb)  # hand-resolved German→scientific crosswalk
    "Ficedula albicollis": {
        "weight_mean": "12.34", "weight_sd": "0.9069",
        "feather_mean": "63.5455", "feather_sd": "2.21",
        "wing_mean": "82.9545", "wing_sd": "2.3785",
        "quotient_mean": "0.766",
        "tarsus_mean": None, "tarsus_sd": None,
    },
}


def forwards_func(apps, schema_editor):
    Species = apps.get_model("birds", "Species")
    SpeciesNorm = apps.get_model("birds", "SpeciesNorm")

    matched = 0
    unmatched = []
    for scientific_name, values in SPECIES_NORMS.items():
        species = Species.objects.filter(scientific_name=scientific_name).first()
        if species is None:
            unmatched.append(scientific_name)
            continue
        SpeciesNorm.objects.update_or_create(
            species=species,
            organization=None,  # the globale Standard-Artennorm layer
            defaults={
                "weight_mean": _d(values["weight_mean"]),
                "weight_sd": _d(values["weight_sd"]),
                "feather_mean": _d(values["feather_mean"]),
                "feather_sd": _d(values["feather_sd"]),
                "wing_mean": _d(values["wing_mean"]),
                "wing_sd": _d(values["wing_sd"]),
                "tarsus_mean": _d(values["tarsus_mean"]),
                "tarsus_sd": _d(values["tarsus_sd"]),
                # Kerbe F2 + Innenfuß: no columns in the sheet → null.
                "notch_f2_mean": None,
                "notch_f2_sd": None,
                "inner_foot_mean": None,
                "inner_foot_sd": None,
                "quotient_mean": _d(values["quotient_mean"]),
                "quotient_tolerance_pct": QUOTIENT_TOLERANCE_PCT,
                "sd_factor": SD_FACTOR,
                # The new sheet has no Geschlechtsbestimmung / dj.-Großgefiedermauser
                # columns → both null (never backfill the 11's curated flags).
                "geschlechtsbestimmung_moeglich": None,
                "dj_grossgefiedermauser_moeglich": None,
            },
        )
        matched += 1

    print(
        f"\n  Standard-Artennorm seed (net-new): matched {matched}/{len(SPECIES_NORMS)}"
        f" species ({len(unmatched)} unmatched)"
    )
    if unmatched:
        print(f"  Unmatched scientific_names: {unmatched}")


def reverse_func(apps, schema_editor):
    # Delete ONLY the 58 this migration added — never the original 11 from 0060.
    Species = apps.get_model("birds", "Species")
    SpeciesNorm = apps.get_model("birds", "SpeciesNorm")
    species_ids = Species.objects.filter(
        scientific_name__in=SPECIES_NORMS.keys()
    ).values_list("id", flat=True)
    SpeciesNorm.objects.filter(
        organization__isnull=True, species_id__in=list(species_ids)
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0060_seed_species_norms"),
    ]

    operations = [
        migrations.RunPython(forwards_func, reverse_func),
    ]
