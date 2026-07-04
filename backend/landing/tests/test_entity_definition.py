"""The homepage's quotable entity definition + self-containment pass (issue #301).

Passage-level AI retrieval lifts a self-contained sentence verbatim as the
answer to „Was ist BirdDoc?", so the marketing home carries one entity-dense
definition paragraph near the top — bilingual like the rest of the surface
(issue #107) — and its key sections name *BirdDoc* rather than leaning on
„es"/„unsere Lösung", so a reader (or an engine) dropped into any single
section from a citation understands it standalone. Exercised through the Django
test client over the public HTTP routes, no JS execution required.
"""


def _entity_definition(content):
    # The entity-definition paragraph — the <p class="hero__definition"> block
    # only, extracted by its public class the way test_hero reads hero__ctas.
    start = content.index("hero__definition")
    return content[start : content.index("</p>", start)]


def _section(content, marker):
    # A single <section> region, from its opening marker to its </section>.
    start = content.index(marker)
    return content[start : content.index("</section>", start)]


def test_home_carries_a_self_contained_entity_definition(client):
    # A self-contained, entity-dense definition sits near the top of the German
    # home: it names BirdDoc and defines it as a Beringungssoftware for the
    # Vogelberingung, so an AI answer engine can lift the sentence verbatim.
    definition = _entity_definition(client.get("/").content.decode())
    assert "BirdDoc ist eine Beringungssoftware" in definition
    assert "Vogelberingung" in definition


def test_en_home_carries_the_english_entity_definition(client):
    # The /en/ variant gets the equivalent treatment: an English definition that
    # names BirdDoc as bird ringing software, with the German source (and the
    # German head term) gone from that page.
    en = client.get("/en/").content.decode()
    definition = _entity_definition(en)
    assert "BirdDoc is bird ringing software" in definition
    assert "BirdDoc ist eine Beringungssoftware" not in en
    assert "Beringungssoftware" not in en


def test_key_home_sections_name_birddoc_standalone(client):
    # The self-containment pass: sections a reader can be dropped into from a
    # citation name BirdDoc rather than referring back with a bare pronoun — the
    # Für-Beringer relief, the hosting statement and the price teaser each name
    # the entity so the passage reads standalone.
    content = client.get("/").content.decode()
    assert "BirdDoc" in _section(content, 'class="pricing"')
    assert "BirdDoc" in _section(content, 'class="hosting"')
    relief_start = content.index('class="relief"')
    relief = content[relief_start : content.index("</ul>", relief_start)]
    assert "BirdDoc" in relief
