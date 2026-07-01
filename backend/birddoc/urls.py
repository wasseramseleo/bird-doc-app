"""
URL configuration for birddoc project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""

from django.conf.urls.i18n import i18n_patterns
from django.contrib import admin
from django.contrib.sitemaps.views import sitemap
from django.urls import include, path

from landing import seo

# The headless API and the Django admin are not part of the bilingual surface —
# they carry no language prefix.
urlpatterns = [
    path("api/birds/", include("birds.urls")),
    path("api/auth/", include("birds.auth_urls")),
    path("api/feedback/", include("birds.feedback_urls")),
    path("admin/", admin.site.urls),
]

# Crawler & share-baseline files (issue #108) plus the favicon (issue #137):
# served at the apex root, OUTSIDE i18n_patterns, so each lives at exactly one
# canonical URL with no language prefix — `/favicon.ico`, `/robots.txt`,
# `/sitemap.xml` and the Fang-Karte Open-Graph image.
urlpatterns += [
    path("favicon.ico", seo.FaviconView.as_view(), name="favicon"),
    path("robots.txt", seo.RobotsTxtView.as_view(), name="robots"),
    path("sitemap.xml", sitemap, {"sitemaps": seo.SITEMAPS}, name="sitemap"),
    path("og/fang-karte.svg", seo.FangKarteOgImageView.as_view(), name="og_fang_karte"),
]

# Public, server-rendered landing served at the apex host (birddoc.eu), kept
# separate from the headless `/api` routes above (issue #71, ADR 0007). It is the
# bilingual surface (issue #107): `prefix_default_language=False` serves German
# at the apex with no prefix and no geo-routing, English under `/en/`. Legal and
# auth pages live here too but stay German regardless of the prefix — their
# templates carry no translatable strings and the auth views force the German
# catalog (GermanAuthFormMixin / translation.override).
urlpatterns += i18n_patterns(
    path("", include("landing.urls")),
    prefix_default_language=False,
)
