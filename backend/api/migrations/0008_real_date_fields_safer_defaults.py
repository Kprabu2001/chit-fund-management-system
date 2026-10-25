import datetime

from django.db import migrations, models


class Migration(migrations.Migration):
    """
    Dates were stored as text. Convert them to real DATE columns and make the
    UserProfile defaults safer (new users start as KYC 'Pending', no preset city).

    Existing values must already be valid YYYY-MM-DD text (the app always wrote that format).
    Back up the database before running this migration.
    """

    dependencies = [
        ("api", "0007_monthlypayment_reminder"),
    ]

    operations = [
        migrations.AlterField(
            model_name="userprofile",
            name="joined_date",
            field=models.DateField(default=datetime.date.today),
        ),
        migrations.AlterField(
            model_name="auctionscheme",
            name="created_date",
            field=models.DateField(default=datetime.date.today),
        ),
        migrations.AlterField(
            model_name="ticket",
            name="issued_date",
            field=models.DateField(default=datetime.date.today),
        ),
        migrations.AlterField(
            model_name="monthlypayment",
            name="due_date",
            field=models.DateField(),
        ),
        migrations.AlterField(
            model_name="monthlypayment",
            name="paid_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="userprofile",
            name="city",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.AlterField(
            model_name="userprofile",
            name="kyc_status",
            field=models.CharField(default="Pending", max_length=30),
        ),
    ]