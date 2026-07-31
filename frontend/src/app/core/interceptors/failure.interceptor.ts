import {HttpInterceptorFn} from '@angular/common/http';
import {catchError, throwError} from 'rxjs';

import {attachAppFailure, classifyFailure} from '../errors/app-failure';

/**
 * Die eine Stelle, an der ein Transportfehler eingeordnet wird (ADR 0037,
 * PRD #438).
 *
 * **Als äußerster Interceptor registriert** (`app.config.ts`): so sieht der
 * `authInterceptor` darunter weiterhin den rohen Fehler und tut seine 401-Arbeit
 * unverändert — und alles, was *unter* dieser Naht entsteht, kommt trotzdem
 * eingeordnet beim Aufrufer an.
 *
 * **Additiv, nicht zerstörend.** Der Fehler wird nicht ersetzt: er reist
 * unverändert weiter und trägt die Einordnung bloß mit sich
 * (`attachAppFailure`). Das ist nicht Bequemlichkeit, sondern Bedingung — die
 * Offline-Fassade verzweigt auf `HttpErrorResponse.status === 0`, um einen Fang
 * in die Outbox zu legen, und der Sync liest den `Retry-After`-Header vom
 * Ursprungsfehler. Ein Interceptor, der stattdessen einen neuen Fehlertyp würfe,
 * würde beides still abschalten, ohne dass eine Spec anschlägt.
 *
 * Ein Bauteil fragt nie den Status, sondern ruft `appFailureOf(error)` und
 * bekommt die **Klasse**.
 */
export const failureInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    catchError((error: unknown) => throwError(() => attachAppFailure(error, classifyFailure(error)))),
  );
