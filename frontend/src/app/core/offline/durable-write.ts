import {HttpContext, HttpContextToken} from '@angular/common/http';

import {sessionExpiryAtTheGesture} from '../errors/session-expiry';

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
 * Sie sagt allein, **was die Fassade tut**: `withDurableFallback` reiht den
 * Inhalt bei der Klasse *Neu anmelden* in die Outbox ein, statt ihn zu
 * verlieren. Der `authInterceptor` liest sie nicht — er liest
 * {@link SESSION_EXPIRY_AT_THE_GESTURE}, die ein dauerhafter Schreibvorgang
 * ({@link durableWrite}) ebenfalls trägt. Die beiden auseinanderzuhalten ist
 * der Punkt: der Fang-Edit hält den Sprung zur Anmeldung genauso zurück —
 * seine Korrektur steht im Formular und sonst nirgends —, wird aber niemals
 * eingereiht.
 *
 * Der zurückgehaltene Sprung ist für den Fang-Create keine Höflichkeit, sondern
 * die Bedingung der Rettung: die Outbox reiht unter dem angemeldeten Konto ein
 * (Mandantengrenze aus #160), und das wäre sonst gelöscht, bevor sie dazu
 * kommt — der Fang mit ihm.
 */
export const DURABLE_WRITE = new HttpContextToken<boolean>(() => false);

/**
 * Der Kontext, mit dem ein dauerhafter Schreibvorgang hinausgeht: eingereiht
 * wird er von der Fassade, und die Aufforderung zur erneuten Anmeldung wartet
 * so lange an der Geste.
 */
export function durableWrite(): HttpContext {
  return sessionExpiryAtTheGesture().set(DURABLE_WRITE, true);
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
