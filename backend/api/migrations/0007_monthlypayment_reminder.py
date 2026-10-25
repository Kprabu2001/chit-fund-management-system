from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0006_profile_payout_nominee"),
    ]

    operations = [
        migrations.AddField(
            model_name="monthlypayment",
            name="reminder_sent_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="monthlypayment",
            name="reminder_count",
            field=models.PositiveIntegerField(default=0),
        ),
    ]