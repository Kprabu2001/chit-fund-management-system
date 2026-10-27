import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """Offline-auction support: prize payout tracking and an audit trail for winner corrections."""

    dependencies = [
        ("api", "0008_real_date_fields_safer_defaults"),
    ]

    operations = [
        migrations.CreateModel(
            name="PrizePayout",
            fields=[
                ("id", models.CharField(max_length=80, primary_key=True, serialize=False)),
                ("month_number", models.IntegerField()),
                ("amount", models.DecimalField(decimal_places=2, max_digits=12)),
                ("status", models.CharField(choices=[("PENDING", "Pending"), ("PAID", "Paid")], default="PENDING", max_length=10)),
                ("utr", models.CharField(blank=True, default="", max_length=100)),
                ("paid_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("details_reminder_sent_at", models.DateTimeField(blank=True, null=True)),
                ("details_reminder_count", models.PositiveIntegerField(default=0)),
                ("auction_record", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="payout", to="api.auctionrecord")),
                ("paid_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="paid_out_prizes", to="api.userprofile")),
                ("scheme", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="prize_payouts", to="api.auctionscheme")),
                ("ticket", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="prize_payouts", to="api.ticket")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="prize_payouts", to="api.userprofile")),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="AuctionCorrection",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False)),
                ("month_number", models.IntegerField()),
                ("old_winner_ticket_id", models.CharField(max_length=50)),
                ("old_winner_name", models.CharField(max_length=150)),
                ("old_discount", models.DecimalField(decimal_places=2, max_digits=12)),
                ("old_net_prize", models.DecimalField(decimal_places=2, max_digits=12)),
                ("reason", models.TextField(blank=True, default="")),
                ("corrected_at", models.DateTimeField(auto_now_add=True)),
                ("corrected_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="auction_corrections", to="api.userprofile")),
                ("scheme", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="auction_corrections", to="api.auctionscheme")),
            ],
            options={"ordering": ["-corrected_at"]},
        ),
    ]