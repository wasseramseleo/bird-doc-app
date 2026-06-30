from django.conf import settings
from django.core.mail import EmailMessage
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def feedback_view(request):
    """Email the operator a logged-in user's feedback (issue #81).

    Reuses the transactional email channel (issue #77): the notification is sent
    from ``DEFAULT_FROM_EMAIL`` (the no-reply sender) to ``OPERATOR_EMAIL``. It
    creates **no** GitHub issue — emailing the operator is the only side effect.
    """
    message = (request.data.get("message") or "").strip()
    if not message:
        return Response(
            {"detail": "Bitte gib eine Nachricht ein."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # The mail leaves from the no-reply sender; setting reply-to to the
    # submitter lets the operator answer them directly. Only public accounts
    # carry an email (ADR 0008) — omit it when there is none.
    reply_to = [request.user.email] if request.user.email else None

    EmailMessage(
        subject=f"BirdDoc Feedback von {request.user.username}",
        body=message,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[settings.OPERATOR_EMAIL],
        reply_to=reply_to,
    ).send()

    return Response({"detail": "Danke für dein Feedback!"})
