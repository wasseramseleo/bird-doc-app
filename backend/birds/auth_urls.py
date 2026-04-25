from django.urls import path

from . import auth_views

urlpatterns = [
    path("login/", auth_views.login_view, name="auth-login"),
    path("logout/", auth_views.logout_view, name="auth-logout"),
    path("me/", auth_views.me_view, name="auth-me"),
]
