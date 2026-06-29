from django.views.generic import TemplateView


class HomeView(TemplateView):
    """The public apex landing page — a plain, server-rendered page served to
    unauthenticated visitors without loading the SPA (issue #71)."""

    template_name = "landing/home.html"
