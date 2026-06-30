import pytest

from birds.accounts import EmailAlreadyExistsError, create_public_account


@pytest.mark.django_db
def test_create_public_account_normalizes_email_to_lowercase():
    user = create_public_account("  Birder@Example.COM  ", "hunter2-very-strong")
    assert user.username == "birder@example.com"
    assert user.email == "birder@example.com"
    assert user.check_password("hunter2-very-strong")


@pytest.mark.django_db
def test_create_public_account_rejects_duplicate_email_case_insensitively():
    create_public_account("birder@example.com", "hunter2-very-strong")
    with pytest.raises(EmailAlreadyExistsError):
        create_public_account("BIRDER@Example.com", "another-strong-pass")
