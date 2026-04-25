# Context
Help me build an angular django application for the documentation, data entry and visualization of bird ringers. 

Professional ornithologists use this software to document the birds which are caught using nets. 

I use Angular 20 and Django 5.2.3.



Right now I finished the initial django setup and model definition. Based on the given models, create generic CRUD REST endpoints for the DataEntry model leveraging the djangorestframework. Therefore please also create the corresponding serializers. Users will select bird species using a dropdown in the frontend. While we will focus on this not now but later, please cosider this in the serializers (select related). 



Please create the serializers.py and views.py for the birds app. 



# FE
Help me build an angular django application for the documentation, data entry and visualization of bird ringers. 

Professional ornithologists use this software to document the birds which are caught using nets. 

I use Angular 20 and Django 5.2.3.

I fnished the backend, providing CRUD endpoints for the relevant models. The next step is to create the main frontend components. I already setup angular with routing and standalone (standard) components. Please create two components concerning the DataEntry model. The first one is a component with a reactive form where the scientist can create new entries or edit old ones. The second component is a list view of DataEntry where the user can filter all fields and do fulltext search where sensible. 

In the create/edit component form, use angular material components as you deem best fitting. For fields with choices use selectors which can be set using keyboard inputs.

For usability, as soon as an input of a choice select is ubiquitous, the choice is selected and the next textbox is focussed. 

This is the order of inputs:

ringing_station, staff, date_time (automatically selects the last full hour of today), species (fulltext search on the german name), bird_status, ring_number,  net_location, net_height, net_direction, fat_deposit, muscle_class, age_class, sex, small_feather_int, small_feather_app, hand_wing, tarsus, feather_span, wing_span, weight_gram, notch_f2, inner_foot, comment.

Create interfaces and enums mimicing the models in the backends as you deem fitting. Use Austria German formatting for date and float values.

Use reactive forms. Create a dedicated service for API calls. Use signals for state management in the frontend. 