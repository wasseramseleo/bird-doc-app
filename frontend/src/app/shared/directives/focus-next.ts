import { Directive, ElementRef, HostListener, Input, inject } from '@angular/core';

@Directive({
  selector: '[appFocusNext]',
  standalone: true
})
export class FocusNextDirective {
  @Input('appFocusNext') nextControlName: string = '';

  private el = inject(ElementRef);

  @HostListener('keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent): void {
    // Check if the pressed key is 'Enter'
    if (event.key === 'Enter') {
      event.preventDefault();
      this.focusNextElement();
    }
  }

  // This works for mat-select and other components that emit on selection
  @HostListener('selectionChange', ['$event'])
  onSelectionChange(event: any): void {
    // A small delay is needed to allow the select panel to close
    setTimeout(() => this.focusNextElement(), 100);
  }

  private focusNextElement(): void {
    if (!this.nextControlName) return;

    const form = this.el.nativeElement.form;
    if (!form) return;

    const nextControl = form.querySelector(`[formControlName="${this.nextControlName}"]`);
    if (nextControl) {
      (nextControl as HTMLElement).focus();
    }
  }
}
