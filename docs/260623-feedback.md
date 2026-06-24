# Feedback
Folgendes Feedback wurde vom Beringer zur aktuellen Applikation gegeben:

1. Data Entry Form: Bei Wiederfang; "Enter" bei Ringnummer feld fokussierung soll die bisherigen Fänge durchsuchen, nicht speichen.
2. Nur eine Nachkommastelle bei Dezimalwerten länge und Gewicht bei der Listenansicht
3. Ringnummer muss die zuletzt eingetragenen Nummer inkremenieren. Nicht die niedrigste noch freie. Bsp: Eintrag 1) Ringnummer 100, Eintrag 2) Ringnummer vorgeschlagen 101. Eintrag 3) Ringnummer manuell 123. Eintrag 4 Ringnummer vorgeschlagen 124.
4. Anstatt Button "Abbrechen" einen Button "Zurücksetzen" mit Bestätigungsmodal bei data entry. User wird nicht zurück zur Listenansicht navigiert, sondern das Formular wird nur zurückgesetzt und das Artenfeld wird fokussiert.
5. Bei bisherige Fänge Fett und Muskel als neue Spalten hinzufügen und dafür mit Beringerkürzel platz sparen
6. Bug: Pflichtfelder zeigen Fehlernachricht, nachdem gespeichert wurde. Form soll bereinigt und keine error angezeigt werden. 
7. Data Entry Form: Arten-dropdown suchergebnisse nach Nutzungshäufigkeit sortieren.
8. Ringgröße zur Nummer input feld als prefix dazuschreiben für bessere Lesbarkeit. Beim Ringgrößen Input feld die Klammer weggeben und feld kleiner machen.
9. Es Fehlen noch Ringgrößen. Es soll die Möglichkeit geben, alle Ringgrößen einzugeben. Siehe @docs/2020_Ringgrößen_Artenliste_AUW.pdf.
10. Im Notfall soll eine Ringgröße überschrieben werden können (mit Bestätigungsmodal). Bei manchen Arten sind zwar Ringgrößen hinterlegt, Männchen und weibchen unterschiedenen sich aber bei den tarsus größen. 
11. Data Entry Form: STRG+S für Speichern bei Neu-einträgen und bearbeitung. "Enter" speichert nur dann den Eintrag, wenn speicher-button fokussiert ist.
12. Data Entry Form: Hinweis bei aktiver Feststelltaste (Manche Felder akzeptieren nur Nummern und es tut sich nichts wenn feststelltaste aktiv)
13. Zum Feld "Kleingefieder Fortschritt": dieses Feld ist nur bei diesjährigen (also wenn der Wert 3 ist) auszufüllen, ansonsten bitte überspringen
14. Einige Spalten für den IWM export werden aktuell noch nicht befüllt und sind nicht teil des applikationsmodells. Die hängen mit der Station zusammen: Land (Austria), Geo-Koordinaten (48.295892, 14.276697), Ortskodierung (AU03), Region (Oberösterreich). Ein Projekt kann also von mehreren verschiedenen Stationen daten bekommen. Weitere Spalten hängen mit dem Projekt zusamen: Umstand (25: Von Mench für Wissenschaftlichen Projekt gefangen), Fangmethode (M=Japannetz), Lockmittel (N=Sicher kein Lockmittel). Siehe @docs/IWM_Linz_Vogelmonitoring_2026-06-24.xlsx als referenz. 
