# Feedback
Folgendes Feedback wurde vom Beringer zur aktuellen Applikation gegeben:

1. Wenn ein Scientist gelöshcht wird, soll anstatt alle verbundenen Dataentrys zu löschen diese zu einem fallback "gelöschter nutzer" Scientist zugewiesen werden
2.  ist in der Artenliste noch "Art nicht in der Liste (Aves ignota)" hinzufügen, just in case. Mit Bemerkung als Pflichtfeld dann idealerweise. Wird wohl nicht passieren, dass mans braucht, aber dass es zumindest dann nicht an der Eingabe scheitert wenn wir den blauschwanz fangen
3. Bei falscher eingabe eines Vogelnames soll es bereits im frontend scheitern, aktuell wird ein "Fehler beim Speichern: Http failure response for https://birddoc.alpinecoders.dev/api/birds/data-entries/: 400 OK" fehler dem user zurückgegeben. 
4.  "zurücksetzen" taste soll auch mit enter drücken funktionieren wenn fokussiert (trotzdem bestätigungsmodal).
5. mir ist ein Bug aufgefallen, der auftritt wenn man im Nachhinein im bearbeitungsmodus versucht eine Uhrzeit zu ändern. Es geht dann meistens zwei Stunden vor die Uhrzeit die man einstellen wollte und zeigts dann falsch an. allgemein wird die datem spalte 2h später eingetragn. erfasst zeit passt. bitte zeitzone prüfen (Europa/Wien ist die korrekte)