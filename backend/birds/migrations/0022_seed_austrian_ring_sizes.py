"""
Seed Species.ring_size for Austrian species from the AOC ring-size scheme.

Source: AUW_RING_SIZES.pdf (AOC / Österreichische Vogelwarte, November 2016).
Match key is scientific_name. Species not listed in the PDF, or listed with
sex-dimorphic / alternate / specialty rings, are intentionally left NULL.
"""

from django.db import migrations


# scientific_name -> ring size code (from AOC PDF, Nov 2016).
PDF_RING_SIZES = {
    # Anseriformes — Anatidae
    "Cygnus olor": "BS",
    "Cygnus cygnus": "BS",
    "Cygnus columbianus": "BS",
    "Branta bernicla": "FA",
    "Branta leucopsis": "FA",
    "Anser fabalis": "FA",
    "Anser albifrons": "FA",
    "Anser erythropus": "FA",
    "Alopochen aegyptiaca": "FA",
    "Tadorna tadorna": "GA",
    "Tadorna ferruginea": "GA",
    "Aix sponsa": "HA",
    "Aix galericulata": "HA",
    "Anas strepera": "GA",
    "Anas penelope": "GA",
    "Anas crecca": "LA",
    "Anas platyrhynchos": "GA",
    "Anas acuta": "HA",
    "Anas querquedula": "LA",
    "Anas clypeata": "GA",
    "Netta rufina": "GA",
    "Aythya nyroca": "HA",
    "Aythya ferina": "HA",
    "Aythya fuligula": "HA",
    "Aythya marila": "HA",
    "Somateria spectabilis": "FA",
    "Clangula hyemalis": "GA",
    "Melanitta nigra": "GA",
    "Melanitta fusca": "GA",
    "Bucephala clangula": "HA",
    "Mergus albellus": "HA",
    "Mergus serrator": "GA",
    "Mergus merganser": "FA",
    # Galliformes — Phasianidae
    "Coturnix coturnix": "P",
    "Alectoris graeca": "H",
    "Perdix perdix": "K",
    "Tetrastes bonasia": "L",
    "Lagopus mutus": "GA",
    # Podicipediformes
    "Tachybabtus ruficollis": "KA",
    "Podiceps cristatus": "GA",
    "Podiceps grisegena": "GA",
    "Podiceps auritus": "HA",
    "Podiceps nigricollis": "HA",
    # Gaviiformes
    "Gavia stellata": "FA",
    "Gavia arctica": "DA",
    "Gavia immer": "FA",
    # Phalacrocoraciformes
    "Phalacrocorax carbo": "FA",
    "Microcarbo pygmeus": "GA",
    # Threskiornithiformes
    "Geronticus eremita": "G",
    "Plegadis falcinellus": "GA",
    "Platalea leucorodia": "FA",
    # Ardeiformes
    "Botaurus stellaris": "FA",
    "Ixobrychus minutus": "LA",
    "Nycticorax nycticorax": "GA",
    "Ardea alba": "FA",
    "Ardea cinerea": "FA",
    "Ardea purpurea": "FA",
    "Bubulcus ibis": "GA",
    "Ardeola ralloides": "GA",
    "Egretta garzetta": "GA",
    # Accipitriformes
    "Pandion haliaetus": "D",
    "Pernis apivorus": "G",
    "Gyps fulvus": "AS",
    "Aegypius monachus": "AS",
    "Aquila pomarina": "F",
    "Aquila clanga": "F",
    "Aquila heliaca": "BS",
    "Aquila chrysaetos": "BS",
    "Circus cyaneus": "H",
    "Circus pygargus": "K",
    "Circus aeruginosus": "H",
    "Milvus milvus": "G",
    "Milvus migrans": "G",
    "Haliaeetus albicilla": "BS",
    "Buteo lagopus": "G",
    # Falconidae
    "Falco vespertinus": "L",
    "Falco subbuteo": "L",
    "Falco eleonorae": "L",
    "Falco naumanni": "L",
    "Falco tinnunculus": "L",
    "Falco cherrug": "G",
    # Gruiformes
    "Grus grus": "D",
    # Rallidae
    "Rallus aquaticus": "N",
    "Crex crex": "N",
    "Porzana porzana": "N",
    "Porzana parva": "P",
    "Porzana pusilla": "P",
    "Gallinula chloropus": "KA",
    "Fulica atra": "GA",
    # Charadriiformes
    "Burhinus oedicnemus": "LA",
    "Haematopus ostralegus": "KA",
    "Himantopus himantopus": "NA",
    "Recurvirostra avosetta": "LA",
    "Pluvialis squatarola": "PA",
    "Pluvialis apricaria": "PA",
    "Vanellus vanellus": "NA",
    "Charadrius dubius": "SA",
    "Charadrius hiaticula": "SA",
    "Charadrius alexandrinus": "SA",
    "Charadrius morinellus": "PA",
    "Numenius phaeopus": "LA",
    "Numenius arquata": "KA",
    "Limosa limosa": "LA",
    "Limosa lapponica": "LA",
    "Scolopax rusticola": "N",
    "Lymnocryptes minimus": "SA",
    "Gallinago media": "NA",
    "Gallinago gallinago": "PA",
    "Phalaropus lobatus": "SA",
    "Phalaropus fulicarius": "SA",
    "Actitis hypoleucos": "SA",
    "Xenus cinereus": "SA",
    "Tringa erythropus": "NA",
    "Tringa totanus": "NA",
    "Tringa stagnatilis": "SA",
    "Tringa nebularia": "NA",
    "Tringa ochropus": "SA",
    "Tringa glareola": "SA",
    "Arenaria interpres": "PA",
    "Limicola falcinellus": "SA",
    "Calidris canutus": "PA",
    "Calidris alba": "SA",
    "Calidris minuta": "TA",
    "Calidris temminckii": "TA",
    "Calidris melanotos": "SA",
    "Calidris ferruginea": "SA",
    "Calidris maritima": "SA",
    "Calidris alpina": "SA",
    # Stercorariidae
    "Stercorarius parasiticus": "NA",
    "Stercorarius longicaudus": "NA",
    "Stercorarius pomarinus": "NA",
    "Stercorarius skua": "GA",
    # Laridae
    "Larus minutus": "LA",
    "Larus ridibundus": "LA",
    "Larus genei": "LA",
    "Larus melanocephalus": "LA",
    "Larus canus": "LA",
    "Larus marinus": "GA",
    "Larus argentatus": "HA",
    "Larus michahellis": "HA",
    "Larus cachinnans": "HA",
    "Larus fuscus": "HA",
    "Larus hyperboreus": "GA",
    # Sternidae
    "Sternula albifrons": "SA",
    "Gelochelidon nilotica": "NA",
    "Hydroprogne caspia": "KA",
    "Chlidonias niger": "PA",
    "Chlidonias hybrida": "PA",
    "Sterna sandvicensis": "NA",
    "Sterna hirundo": "PA",
    "Sterna paradisaea": "PA",
    # Columbiformes
    "Columba livia f. domestica": "M",
    "Columba oenas": "L",
    "Columba palumbus": "K",
    "Streptopelia decaocto": "M",
    "Streptopelia turtur": "M",
    # Cuculiformes
    "Cuculus canorus": "N",
    # Strigiformes
    "Tyto alba": "H",
    "Aegolius funereus": "K",
    "Athene noctua": "K",
    "Glaucidium passerinum": "M",
    "Otus scops": "L",
    "Asio otus": "K",
    "Asio flammeus": "H",
    "Bubo bubo": "C",
    "Strix aluco": "H",
    "Strix uralensis": "F",
    # Caprimulgiformes
    "Caprimulgus europaeus": "P",
    # Apodiformes
    "Apus melba": "N",
    "Apus apus": "R",
    "Apus pallidus": "R",
    # Coraciiformes
    "Alcedo atthis": "R",
    "Merops apiaster": "R",
    "Coracias garrulus": "N",
    # Upupiformes
    "Upupa epops": "N",
    # Piciformes
    "Jynx torquilla": "S",
    "Picus canus": "N",
    "Picus viridis": "N",
    "Dryocopus martius": "L",
    "Picoides tridactylus": "P",
    "Dendrocopos major": "P",
    "Dendrocopos syriacus": "P",
    "Dendrocopos medius": "P",
    "Dendrocopos leucotos": "P",
    "Dryobates minor": "S",
    # Passeriformes — Oriolidae
    "Oriolus oriolus": "P",
    # Laniidae
    "Lanius senator": "SA",
    "Lanius minor": "PA",
    "Lanius collurio": "SA",
    "Lanius excubitor": "PA",
    # Corvidae
    "Pyrrhocorax graculus": "LA",
    "Pyrrhocorax pyrrhocorax": "LA",
    "Pica pica": "LA",
    "Garrulus glandarius": "NA",
    "Nucifraga caryocatactes": "LA",
    "Corvus monedula": "LA",
    "Corvus frugilegus": "KA",
    "Corvus corone": "KA",
    "Corvus cornix": "KA",
    "Corvus corax": "GA",
    # Remizidae
    "Remiz pendulinus": "V",
    # Paridae
    "Parus caeruleus": "V",
    "Parus major": "T",
    "Parus cristatus": "V",
    "Parus ater": "V",
    "Parus palustris": "V",
    "Parus montanus": "V",
    # Alaudidae
    "Galerida cristata": "S",
    "Lullula arborea": "T",
    "Alauda arvensis": "T",
    # Hirundinidae
    "Riparia riparia": "V",
    "Ptyonoprogne rupestris": "V",
    "Hirundo rustica": "V",
    "Delichon urbica": "V",
    # Panuridae / Aegithalidae
    "Panurus biarmicus": "V",
    "Aegithalos caudatus": "X",
    # Cettiidae
    "Cettia cetti": "V",
    # Phylloscopidae
    "Phylloscopus sibilatrix": "V",
    "Phylloscopus bonelli": "V",
    "Phylloscopus trochilus": "V",
    "Phylloscopus collybita": "X",
    "Phylloscopus ibericus": "X",
    "Phylloscopus inornatus": "V",
    "Phylloscopus trochiloides": "V",
    # Megaluridae
    "Locustella naevia": "V",
    "Locustella fluviatilis": "T",
    "Locustella luscinioides": "V",
    # Acrocephalidae
    "Acrocephalus melanopogon": "V",
    "Acrocephalus paludicola": "V",
    "Acrocephalus schoenobaenus": "V",
    "Acrocephalus dumetorum": "T",
    "Acrocephalus palustris": "V",
    "Acrocephalus scirpaceus": "V",
    "Acrocephalus arundinaceus": "S",
    "Hippolais pallida": "V",
    "Hippolais icterina": "V",
    "Hippolais polyglotta": "V",
    # Cisticolidae
    "Cisticola juncidis": "V",
    # Sylviidae
    "Sylvia atricapilla": "T",
    "Sylvia borin": "T",
    "Sylvia nisoria": "S",
    "Sylvia curruca": "V",
    "Sylvia communis": "V",
    # Regulidae
    "Regulus regulus": "X",
    "Regulus ignicapillus": "X",
    # Bombycillidae
    "Bombycilla garrulus": "S",
    # Tichodromadidae / Sittidae / Certhiidae
    "Tichodroma muraria": "V",
    "Sitta europaea": "T",
    "Certhia familiaris": "X",
    "Certhia brachydactyla": "X",
    # Troglodytidae / Sturnidae / Cinclidae
    "Troglodytes troglodytes": "X",
    "Sturnus vulgaris": "P",
    "Cinclus cinclus": "P",
    # Turdidae
    "Turdus viscivorus": "P",
    "Turdus torquatus": "P",
    "Turdus merula": "P",
    "Turdus pilaris": "P",
    "Turdus philomelos": "P",
    "Turdus iliacus": "P",
    # Muscicapidae
    "Muscicapa striata": "V",
    "Ficedula parva": "V",
    "Ficedula hypoleuca": "V",
    "Ficedula albicollis": "V",
    "Monticola saxatilis": "P",
    "Saxicola rubetra": "V",
    "Saxicola torquata": "V",
    "Erithacus rubecula": "V",
    "Luscinia luscinia": "T",
    "Luscinia megarhynchos": "T",
    "Luscinia svecica": "V",
    "Phoenicurus ochruros": "V",
    "Phoenicurus phoenicurus": "V",
    "Oenanthe oenanthe": "T",
    # Prunellidae
    "Prunella collaris": "S",
    "Prunella modularis": "V",
    # Passeridae
    "Passer domesticus": "T",
    "Passer montanus": "T",
    "Petronia petronia": "T",
    "Montifringilla nivalis": "S",
    # Motacillidae
    "Anthus campestris": "T",
    "Anthus trivialis": "T",
    "Anthus pratensis": "T",
    "Anthus cervinus": "V",
    "Anthus spinoletta": "T",
    "Anthus petrosus": "T",
    "Motacilla cinerea": "V",
    "Motacilla flava": "V",
    "Motacilla alba": "T",
    # Fringillidae
    "Fringilla coelebs": "T",
    "Fringilla montifringilla": "T",
    "Coccothraustes coccothraustes": "SA",
    "Pyrrhula pyrrhula": "T",
    "Carpodacus erythrinus": "T",
    "Serinus serinus": "V",
    "Loxia bifasciata": "S",
    "Loxia pytyopsittacus": "S",
    "Loxia curvirostra": "S",
    "Carduelis chloris": "T",
    "Carduelis carduelis": "V",
    "Carduelis citrinella": "V",
    "Carduelis spinus": "V",
    "Carduelis cannabina": "V",
    "Carduelis flavirostris": "V",
    "Carduelis flammea": "V",
    "Carduelis hornemanni": "V",
    # Emberizidae
    "Calcarius lapponicus": "T",
    "Plectrophenax nivalis": "T",
    "Emberiza leucocephala": "T",
    "Emberiza citrinella": "T",
    "Emberiza cirlus": "T",
    "Emberiza cia": "T",
    "Emberiza hortulana": "T",
    "Emberiza pusilla": "V",
    "Emberiza aureola": "T",
    "Emberiza bruniceps": "T",
    "Emberiza melanocephala": "T",
    "Emberiza schoeniclus": "T",
    "Miliaria calandra": "S",
}


# Species in the PDF that we intentionally do NOT seed. Kept here for the
# reviewer's benefit and so future maintainers know these were considered.
SKIPPED_SCIENTIFIC_NAMES = {
    # Sex-dimorphic — different ring size for male and female. Ringer must pick.
    "Phasianus colchicus",
    "Tetrao tetrix",
    "Tetrao urogallus",
    "Accipiter gentilis",
    "Accipiter nisus",
    "Buteo buteo",
    "Falco columbarius",
    "Falco peregrinus",
    "Otis tarda",
    "Philomachus pugnax",
    # Alternate sizes (Stahl vs. mit Lasche) — no single default in PDF.
    "Branta canadensis",
    "Anser anser",
    # Specialty rings not in the standard size table.
    "Ciconia nigra",      # ELSA-Storchenring or F
    "Ciconia ciconia",    # ELSA-Storchenring only
    "Gypaetus barbatus",  # A-Spezialring
}


def forwards_func(apps, schema_editor):
    Species = apps.get_model("birds", "Species")
    matched = 0
    unmatched = []
    for scientific_name, ring_size in PDF_RING_SIZES.items():
        updated = Species.objects.filter(scientific_name=scientific_name).update(
            ring_size=ring_size
        )
        if updated:
            matched += updated
        else:
            unmatched.append(scientific_name)
    print(
        f"\n  AUW ring-size seed: matched {matched}/{len(PDF_RING_SIZES)} species"
        f" ({len(unmatched)} unmatched)"
    )
    if unmatched:
        print(f"  Unmatched scientific_names: {unmatched}")


def reverse_func(apps, schema_editor):
    Species = apps.get_model("birds", "Species")
    Species.objects.filter(scientific_name__in=PDF_RING_SIZES.keys()).update(ring_size=None)


class Migration(migrations.Migration):
    dependencies = [
        ("birds", "0021_alter_ring_size_alter_species_ring_size"),
    ]

    operations = [
        migrations.RunPython(forwards_func, reverse_func),
    ]
