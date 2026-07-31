import {HttpContext, HttpContextToken} from '@angular/common/http';

/**
 * **Wo** eine abgelaufene Sitzung gemeldet wird (#447, ADR 0037) — nicht, ob
 * sie gerettet wird. Das ist die Dauerhaftigkeit und steht anderswo
 * (`core/offline/durable-write.ts`, ADR 0039).
 *
 * Der `authInterceptor` behandelt einen 401 global: Sitzung leeren, Sprung zur
 * Anmeldung. Für alles, was der Klient im Hintergrund tut — jeden Ladevorgang,
 * jede Liste —, ist das richtig: dort entdeckt die App, dass die Sitzung tot
 * ist, und niemand steht mit einer Geste davor.
 *
 * Für einen Schreibvorgang, den ein Mitglied gerade ausgelöst hat, ist es
 * falsch. ADR 0037 sagt, wohin eine Zurückweisung gehört: **dorthin, wo die
 * Geste stattfand** — in das Banner am Formular, mit dem Knopf „Anmelden" als
 * dem einen Ausweg der Klasse *Neu anmelden*. Der globale Sprung kommt dem
 * zuvor und nimmt dem Mitglied das Formular unter den Händen weg: die
 * Navigation weckt den `unsavedChangesGuard` (#407), der „Erfassung verlassen?"
 * fragt, und wer „Verwerfen" drückt, verliert genau die Korrektur, die noch
 * niemand irgendwo gespeichert hat.
 *
 * Die Markierung sagt: **dieser Fehlschlag wird an Ort und Stelle gemeldet.**
 * Der Interceptor hält daraufhin zurück, was das Mitglied wegreißen würde — das
 * Leeren des angemeldeten Kontos, das Leeren des Referenz-Bündels und den
 * Sprung zur Anmeldung. Abgemeldet wird, wenn das Mitglied „Anmelden" im Banner
 * drückt; der Knopf ruft dafür `AuthService.sessionExpired()`.
 *
 * Was er **nicht** zurückhält, ist die zwischengespeicherte Identität: die
 * stirbt mit der Sitzung, immer (#156/#158). Auf einem geteilten Tablet an der
 * Station dürfte sie sonst ein Mitglied überdauern, das den Deckel zuklappt,
 * ohne „Anmelden" gedrückt zu haben — und der nächste Kaltstart ohne Empfang
 * meldete den Vorigen wieder an. Die Outbox stört das nicht: sie reiht unter
 * `AuthService.currentUser()` ein, dem Signal im Speicher, nicht unter dem
 * Zwischenspeicher.
 *
 * Wer sie trägt: die beiden dauerhaften Schreibvorgänge (Fang-Create,
 * Beringer-Schnellanlage) und der **Fang-Edit**, der laut scheitert und dessen
 * Korrektur trotzdem im Formular stehen bleiben muss. Station, Projekt und
 * Artennorm tragen sie nicht — dort ist der Sprung zur Anmeldung unverändert.
 */
export const SESSION_EXPIRY_AT_THE_GESTURE = new HttpContextToken<boolean>(() => false);

/** Der Kontext, mit dem ein solcher Schreibvorgang hinausgeht. */
export function sessionExpiryAtTheGesture(): HttpContext {
  return new HttpContext().set(SESSION_EXPIRY_AT_THE_GESTURE, true);
}
