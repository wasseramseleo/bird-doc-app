from birds.kuerzel import derive_handle


def test_derives_austrian_standard_first_initial_plus_two_of_surname():
    assert derive_handle("Filip", "Reiter") == "FRE"


def test_folds_umlauts_to_ascii():
    assert derive_handle("Jana", "Müller") == "JMU"


def test_normalises_to_uppercase_regardless_of_typed_casing():
    assert derive_handle("filip", "reiter") == "FRE"
