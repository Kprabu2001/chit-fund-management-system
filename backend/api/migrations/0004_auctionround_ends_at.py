from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0003_phoneotp'),
    ]

    operations = [
        migrations.AddField(
            model_name='auctionround',
            name='ends_at',
            field=models.DateTimeField(blank=True, null=True,
                                       help_text='Server-authoritative auction deadline. Bids received after this timestamp are rejected.'),
        ),
        migrations.AlterField(
            model_name='auctionround',
            name='time_left_seconds',
            field=models.IntegerField(default=600,
                                      help_text='Deprecated: use ends_at for server-side enforcement. Kept for backward compatibility.'),
        ),
    ]
