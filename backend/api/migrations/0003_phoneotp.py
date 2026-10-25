# Generated manually for PhoneOTP model
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0002_auctionrecord_paymentledgerentry_auctionbid_bidder_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='PhoneOTP',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False)),
                ('phone', models.CharField(db_index=True, max_length=20)),
                ('otp_code', models.CharField(max_length=6)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField()),
                ('attempts', models.IntegerField(default=0)),
                ('is_used', models.BooleanField(default=False)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
