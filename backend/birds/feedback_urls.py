from django.urls import path

from . import feedback_views

urlpatterns = [
    path("", feedback_views.feedback_view, name="feedback"),
]
