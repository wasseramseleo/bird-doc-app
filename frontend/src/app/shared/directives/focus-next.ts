import { Directive, ElementRef, inject, input } from '@angular/core';

@Directive({
  selector: '[appFocusNext]',
  standalone: true,
  host: {
    '(keydown)': 'handleKeyDown($event)',
    '(selectionChange)': 'onSelectionChange($event)',
  },
})
export class FocusNextDirective {
  readonly nextControlName = input('', { alias: 'appFocusNext' });

  private el = inject(ElementRef);

  handleKeyDown(event: KeyboardEvent): void {
    // Check if the pressed key is 'Enter'
    if (event.key === 'Enter') {
      event.preventDefault();
      this.focusNextElement();
    }
  }

  // This works for mat-select and other components that emit on selection
  onSelectionChange(event: any): void {
    // A small delay is needed to allow the select panel to close
    setTimeout(() => this.focusNextElement(), 100);
  }

  private focusNextElement(): void {
    const nextControlName = this.nextControlName();
    if (!nextControlName) return;

    const form = this.el.nativeElement.form;
    if (!form) return;

    const nextControl = form.querySelector(`[formControlName="${nextControlName}"]`);
    if (nextControl) {
      (nextControl as HTMLElement).focus();
    }
  }
}
