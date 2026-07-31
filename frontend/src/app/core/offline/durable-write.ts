import {HttpContext, HttpContextToken} from '@angular/common/http';

/**
 * Die Dauerhaftigkeit (ADR 0039, PRD #438): **ein Schreibvorgang, dessen Inhalt
 * sonst nirgends existiert, muss dauerhaft sein; ein Schreibvorgang, der nur
 * ändert, was der Server bereits hält, darf laut scheitern.**
 *
 * | dauerhaft | scheitert laut |
 * |---|---|
 * | Fang-Create | Fang-Edit |
 * | Beringer-Schnellanlage (#167) | Station, Projekt, Artennorm |
 *
 * Beides steht in `DataAccessFacadeService`: nur die beiden dauerhaften
 * Schreibvorgänge gehen über die Fassade hinaus und tragen deshalb die
 * Markierung unten. Alles andere geht direkt über `ApiService` und scheitert
 * damit unverändert laut.
 */

/**
 * Die Markierung an der Anfrage: „der Inhalt dieser Anfrage existiert sonst
 * nirgends".
 *
 * Der `authInterceptor` liest sie und **hält seine 401-Arbeit zurück** — kein
 * Leeren der Sitzung, kein Sprung zur Anmeldung —, damit die Fassade den Fang
 * erst in die Outbox retten kann. Ohne das käme die Aufforderung zur erneuten
 * Anmeldung *vor* der Rettung, und die Rettung selbst käme zu spät: die Outbox
 * reiht unter dem angemeldeten Konto ein (Mandantengrenze aus #160), und das
 * wäre dann schon gelöscht.
 */
export const DURABLE_WRITE = new HttpContextToken<boolean>(() => false);

/** Der Kontext, mit dem ein dauerhafter Schreibvorgang hinausgeht. */
export function durableWrite(): HttpContext {
  return new HttpContext().set(DURABLE_WRITE, true);
}

/**
 * Wo am Fehler hängt, dass sein Inhalt trotzdem sicher ist.
 *
 * Ein Symbol und nicht aufzählbar — dieselbe Haltung wie `attachAppFailure`
 * (`core/errors/app-failure.ts`): der Fehler bleibt byteweise der, der er war,
 * `instanceof HttpErrorResponse` trägt weiter, und `status` steht unangetastet da.
 */
const DURABLY_QUEUED = Symbol('DurablyQueued');

/**
 * Hängt an einen Fehlschlag, dass sein Inhalt dennoch dauerhaft eingereiht
 * wurde, und gibt **denselben** Fehler zurück.
 *
 * Ein Fehlschlag bleibt es: die Sitzung ist tot und muss erneuert werden, und
 * genau das sagt das Banner. Nur der Fang ist keiner mehr — er liegt als *nicht
 * synchronisiert* in der Outbox und überträgt sich nach der Anmeldung selbst.
 */
export function attachDurablyQueued<T>(error: T): T {
  if (error && (typeof error === 'object' || typeof error === 'function')) {
    Object.defineProperty(error, DURABLY_QUEUED, {
      value: true,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return error;
}

/**
 * Ob dieser Fehlschlag seinen Inhalt dauerhaft gesichert hat.
 *
 * Das ist, was das Formular fragt: eine Speicherung, die den Fang eingereiht
 * hat, hinterlässt kein ungespeichertes Formular — der `unsavedChangesGuard`
 * (#407) hätte sonst noch etwas zu verwerfen, obwohl längst nichts mehr auf dem
 * Spiel steht.
 */
export function isDurablyQueued(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as {[DURABLY_QUEUED]?: boolean})[DURABLY_QUEUED] === true
  );
}
