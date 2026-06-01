import {Directive, ElementRef, OnDestroy, OnInit, inject} from '@angular/core';
import {MatAutocompleteTrigger} from '@angular/material/autocomplete';

/**
 * Commits the highlighted autocomplete option when the user presses Tab.
 *
 * The listener is registered in the capture phase so it runs *before*
 * MatAutocompleteTrigger's own (bubble-phase) keydown handler closes the panel.
 * Once the panel is closed `activeOption` is null, which is why the previous
 * bubble-phase implementation left the input holding the raw typed text.
 *
 * Calling `activeOption.select()` emits `optionSelected`, so Material assigns the
 * option value to the control and updates the displayed text via `displayWith`.
 * Native Tab is left untouched so focus still advances to the next field.
 */
@Directive({
  selector: 'input[selectOnTab]',
})
export class SelectOnTabDirective implements OnInit, OnDestroy {
  private readonly autoTrigger = inject(MatAutocompleteTrigger, {optional: true});
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') {
      return;
    }
    const activeOption = this.autoTrigger?.activeOption;
    if (this.autoTrigger?.panelOpen && activeOption) {
      activeOption.select();
    }
  };

  ngOnInit(): void {
    this.el.nativeElement.addEventListener('keydown', this.onKeydown, true);
  }

  ngOnDestroy(): void {
    this.el.nativeElement.removeEventListener('keydown', this.onKeydown, true);
  }
}
