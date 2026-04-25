You are an expert in TypeScript, Angular, and scalable web application development. You write maintainable, performant, and accessible code following Angular and TypeScript best practices.
## TypeScript Best Practices
- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain
## Angular Best Practices
- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default.
- Use signals for state management
- Implement lazy loading for feature routes
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead
- Use `NgOptimizedImage` for all static images.
  - `NgOptimizedImage` does not work for inline base64 images.
## Components
- Keep components small and focused on a single responsibility
- Use `input()` and `output()` functions instead of decorators
- Use `computed()` for derived state
- Set `changeDetection: ChangeDetectionStrategy.OnPush` in `@Component` decorator
- Prefer inline templates for small components
- Prefer Reactive forms instead of Template-driven ones
- Do NOT use `ngClass`, use `class` bindings instead
- DO NOT use `ngStyle`, use `style` bindings instead
## State Management
- Use signals for local component state
- Use `computed()` for derived state
- Keep state transformations pure and predictable
- Do NOT use `mutate` on signals, use `update` or `set` instead
## Templates
- Keep templates simple and avoid complex logic
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Use the async pipe to handle observables
## Services
- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Use the `inject()` function instead of constructor injection



# Form Component
I finished the backend, providing CRUD endpoints for the relevant models. The next step is to create the main frontend components. I already setup angular with routing and standalone (standard) components. Please create a component with a reactive form where the scientist can create new entries or edit old ones.
In the create/edit component form, use angular material components as you deem best fitting. For fields with choices use selectors which can be set using keyboard inputs.
For usability, as soon as an input of a choice select is ubiquitous, the choice is selected and the next textbox is focussed.
This is the order of inputs:
ringing_station, staff, date_time (automatically selects the last full hour of today), species (fulltext search on the german name), bird_status, ring_number, net_location, net_height, net_direction, fat_deposit, muscle_class, age_class, sex, small_feather_int, small_feather_app, hand_wing, tarsus, feather_span, wing_span, weight_gram, notch_f2, inner_foot, comment.
Create interfaces and enums mimicing the models in the backends as you deem fitting. Use Austria German formatting for date and float values.
Use reactive forms. Create a dedicated service for API calls. Use signals for state management in the frontend.
