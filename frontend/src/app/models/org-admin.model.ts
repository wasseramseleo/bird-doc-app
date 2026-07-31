// Ein Admin der **eigenen** Organisation, so wie „Freigeben lassen" ihn nennt
// (#450, ADR 0037/0005): Name und Kürzel, sonst nichts. Keine E-Mail, kein
// Benutzername — es sind neue personenbezogene Daten auf der Leitung, und mehr
// als einen Namen braucht die Bitte um eine Freigabe nicht.
//
// Beides kann fehlen und nichts davon wird erfunden: ein Konto, das (noch) kein
// Beringer ist, trägt kein Kürzel (`null`), und ein Konto ohne hinterlegten Namen
// trägt einen leeren. Wen die App weder benennen noch abkürzen kann, den nennt
// sie nicht.
export interface OrgAdmin {
  name: string;
  handle: string | null;
}
