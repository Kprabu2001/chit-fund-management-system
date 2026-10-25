from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token
from decimal import Decimal
from api.models import (
    UserProfile, ValueTier, AuctionScheme, Ticket,
    MonthlyPayment, AuctionRound, AuctionBid, AuctionRecord, PaymentLedgerEntry
)

class Command(BaseCommand):
    help = 'Seeds initial data for AuctionTicket Pro with real auth users, tokens, 1L scheme, and Decimal precision'

    def handle(self, *args, **options):
        self.stdout.write("Seeding database...")

        # Repair out-of-order data: a month marked PAID while an earlier month is still unpaid
        for t in Ticket.objects.all():
            pays = list(MonthlyPayment.objects.filter(ticket=t).order_by('month_number'))
            first_unpaid = next((x.month_number for x in pays if x.status != 'PAID'), None)
            if first_unpaid is None:
                continue
            for x in pays:
                if x.month_number > first_unpaid and x.status == 'PAID':
                    x.status = 'DUE'
                    x.paid_date = None
                    x.payment_method = None
                    x.transaction_ref = None
                    x.receipt_number = None
                    x.is_verified = False
                    x.verified_at = None
                    x.save()
                    t.total_months_paid = max(0, t.total_months_paid - 1)
                    t.save()
                    self.stdout.write(f"Reverted out-of-order payment {x.id} to DUE.")

        # The old 1.5 Lakh sample scheme was replaced by the fixed 5 Lakh scheme (SCH-GLD-5L).
        # Remove it with its sample tickets/payments/rounds so it doesn't linger next to the new one.
        AuctionScheme.objects.filter(id='SCH-SLV-01').delete()

        # Remove stale duplicate-value schemes left by older seeds (they hide the real ones in the UI)
        stale = AuctionScheme.objects.filter(id__in=['SCH-BRZ-01', 'SCH-DMD-01', 'SCH-STR-01'])
        removed = 0
        for sc in stale:
            if not Ticket.objects.filter(scheme=sc).exists():
                sc.delete()
                removed += 1
        if removed:
            self.stdout.write(f"Removed {removed} stale duplicate scheme(s).")

        # 1. Tiers
        tiers_data = [
            {
                'id': 'starter',
                'name': '25K – 50K',
                'range_label': '₹25,000 – ₹50,000',
                'min_val': Decimal('25000.00'),
                'max_val': Decimal('50000.00'),
                'badge': 'Beginner Friendly',
                'color': '#06b6d4',
                'icon': 'sparkles',
                'description': 'Low commitment ticket pools designed for small monthly savings, micro-emergencies, and quick liquidity.'
            },
            {
                'id': 'bronze',
                'name': '50K – 1 Lakh',
                'range_label': '₹50,001 – ₹1,00,000',
                'min_val': Decimal('50000.01'),
                'max_val': Decimal('100000.00'),
                'badge': 'Popular for Personal Goals',
                'color': '#f97316',
                'icon': 'shield',
                'description': 'Perfect for gadget purchases, festival planning, and quarterly savings targets.'
            },
            {
                'id': 'silver',
                'name': '1 Lakh – 2 Lakh',
                'range_label': '₹1,00,001 – ₹2,00,000',
                'min_val': Decimal('100000.01'),
                'max_val': Decimal('200000.00'),
                'badge': 'Most Popular ⭐',
                'color': '#e2e8f0',
                'accent_color': '#38bdf8',
                'icon': 'award',
                'description': 'Prime tier for business inventory, weddings, vehicle down payments, and medium-term investments.'
            },
            {
                'id': 'gold',
                'name': '2 Lakh – 5 Lakh',
                'range_label': '₹2,00,001 – ₹5,00,000',
                'min_val': Decimal('200000.01'),
                'max_val': Decimal('500000.00'),
                'badge': 'High Yield & Liquidity',
                'color': '#eab308',
                'icon': 'crown',
                'description': 'High-value ticket pools tailored for MSME working capital, commercial expansions, and milestone wealth.'
            },
            {
                'id': 'diamond',
                'name': '5 Lakh – 10 Lakh',
                'range_label': '₹5,00,001 – ₹10,00,000',
                'min_val': Decimal('500000.01'),
                'max_val': Decimal('1000000.00'),
                'badge': 'VIP Elite Pool',
                'color': '#a855f7',
                'icon': 'gem',
                'description': 'Premier institutional and HNI auction tickets with maximized monthly dividend returns.'
            }
        ]

        for t in tiers_data:
            ValueTier.objects.update_or_create(id=t['id'], defaults=t)
        self.stdout.write(self.style.SUCCESS(f"Loaded {len(tiers_data)} Value Tiers."))

        # 2. Users (Real Django Auth Users + UserProfiles + Auth Tokens)
        users_seed = [
            {
                'profile_id': 'usr_01',
                'username': 'user@auctionticket.com',
                'email': 'user@auctionticket.com',
                'password': 'user123',
                'name': 'Rahul Sharma',
                'phone': '+91 98765 43210',
                'role': 'user',
                'city': 'Mumbai',
                'kyc_status': 'Verified',
                'wallet_balance': Decimal('24500.00'),
                'is_staff': False,
                'avatar': 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
                'joined_date': '2026-01-05'
            },
            {
                'profile_id': 'adm_01',
                'username': 'admin@auctionticket.com',
                'email': 'admin@auctionticket.com',
                'password': 'admin123',
                'name': 'Admin Chief Executive',
                'phone': '+91 99999 88888',
                'role': 'admin',
                'city': 'Bangalore HQ',
                'kyc_status': 'Verified',
                'wallet_balance': Decimal('1250000.00'),
                'is_staff': True,
                'is_superuser': True,
                'avatar': 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
                'joined_date': '2025-10-01'
            },
            {
                'profile_id': 'usr_02',
                'username': 'priya@example.com',
                'email': 'priya@example.com',
                'password': 'priya123',
                'name': 'Priya Sundaram',
                'phone': '+91 98220 11223',
                'role': 'user',
                'city': 'Chennai',
                'kyc_status': 'Verified',
                'wallet_balance': Decimal('18000.00'),
                'is_staff': False,
                'avatar': 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150',
                'joined_date': '2026-01-12'
            },
            {
                'profile_id': 'usr_03',
                'username': 'vikram@example.com',
                'email': 'vikram@example.com',
                'password': 'vikram123',
                'name': 'Vikram Malhotra',
                'phone': '+91 99112 33445',
                'role': 'user',
                'city': 'Delhi NCR',
                'kyc_status': 'Verified',
                'wallet_balance': Decimal('42000.00'),
                'is_staff': False,
                'avatar': 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150',
                'joined_date': '2026-01-18'
            }
        ]

        for u in users_seed:
            django_user, _ = User.objects.get_or_create(username=u['username'], defaults={'email': u['email']})
            django_user.email = u['email']
            django_user.is_staff = u['is_staff']
            django_user.is_superuser = u.get('is_superuser', False)
            django_user.set_password(u['password'])
            django_user.save()

            Token.objects.get_or_create(user=django_user)

            UserProfile.objects.update_or_create(
                id=u['profile_id'],
                defaults={
                    'user': django_user,
                    'name': u['name'],
                    'email': u['email'],
                    'phone': u['phone'],
                    'role': u['role'],
                    'city': u['city'],
                    'kyc_status': u['kyc_status'],
                    'wallet_balance': u['wallet_balance'],
                    'avatar': u['avatar'],
                    'joined_date': u['joined_date'],
                }
            )
        self.stdout.write(self.style.SUCCESS(f"Loaded {len(users_seed)} Authenticated Users with Tokens."))

        # 3. Schemes
        starter_tier = ValueTier.objects.get(id='starter')
        bronze_tier = ValueTier.objects.get(id='bronze')
        silver_tier = ValueTier.objects.get(id='silver')
        gold_tier = ValueTier.objects.get(id='gold')
        diamond_tier = ValueTier.objects.get(id='diamond')

        schemes_data = [
            # 1. Lakshya ₹1,00,000 Scheme (20 mo, 20 members, ₹5,000/mo)
            {
                'id': 'SCH-BRZ-1L',
                'name': '1 Lakh Chit',
                'tier': bronze_tier,
                'total_value': Decimal('100000.00'),
                'duration_months': 20,
                'monthly_installment': Decimal('5000.00'),
                'total_slots': 20,
                'booked_slots': 18,
                'auction_day': 10,
                'auction_time': '05:30 PM',
                'current_month': 3,
                'status': 'active',
                'max_bid_discount': Decimal('30.00'),
                'min_bid_discount': Decimal('5.00'),
                'commission_percent': Decimal('5.00'),
                'winner_dividend_eligible': False,
                'description': 'Standard ₹1,00,000 scheme: 20 members, 20 months, ₹5,000 monthly installment, 5% foreman commission.',
                'rules': 'Conducted under Section 21 of the Chit Funds Act, 1982. 5% commission. Remainder distributed to non-prized members.',
                'created_date': '2026-01-01'
            },
            # 2. Gold ₹5,00,000 Scheme (20 mo, 20 members, ₹25,000/mo)
            {
                'id': 'SCH-GLD-5L',
                'name': '5 Lakh Chit',
                'tier': gold_tier,
                'total_value': Decimal('500000.00'),
                'duration_months': 20,
                'monthly_installment': Decimal('25000.00'),
                'total_slots': 20,
                'booked_slots': 18,
                'auction_day': 15,
                'auction_time': '06:00 PM',
                'current_month': 4,
                'status': 'active',
                'max_bid_discount': Decimal('30.00'),
                'min_bid_discount': Decimal('5.00'),
                'commission_percent': Decimal('5.00'),
                'winner_dividend_eligible': False,
                'description': 'Standard ₹5,00,000 scheme: 20 members, 20 months, ₹25,000 monthly installment, 5% foreman commission.',
                'rules': 'Standard Chit Fund Act, 1982 rules apply. 5% organizer commission deducted from winning discount.',
                'created_date': '2026-01-01'
            },
            # 3. Silver Royale ₹2,00,000 Scheme (20 mo, 20 members, ₹10,000/mo)
            {
                'id': 'SCH-SLV-02',
                'name': '2 Lakh Chit',
                'tier': silver_tier,
                'total_value': Decimal('200000.00'),
                'duration_months': 20,
                'monthly_installment': Decimal('10000.00'),
                'total_slots': 20,
                'booked_slots': 18,
                'auction_day': 20,
                'auction_time': '07:00 PM',
                'current_month': 3,
                'status': 'active',
                'max_bid_discount': Decimal('30.00'),
                'min_bid_discount': Decimal('5.00'),
                'commission_percent': Decimal('5.00'),
                'winner_dividend_eligible': False,
                'description': 'Premium 2 Lakh ticket scheme for higher monthly liquidity with guaranteed dividend discounts.',
                'rules': 'Monthly auction on 20th. Winner receives net prize within 24 hours of documentation verification.',
                'created_date': '2026-01-01'
            },
            # 4. Gold Enterprise ₹3,00,000 Scheme (20 mo, 20 members, ₹15,000/mo)
            {
                'id': 'SCH-GLD-01',
                'name': '3 Lakh Chit',
                'tier': gold_tier,
                'total_value': Decimal('300000.00'),
                'duration_months': 20,
                'monthly_installment': Decimal('15000.00'),
                'total_slots': 20,
                'booked_slots': 20,
                'auction_day': 25,
                'auction_time': '06:30 PM',
                'current_month': 3,
                'status': 'active',
                'max_bid_discount': Decimal('25.00'),
                'min_bid_discount': Decimal('5.00'),
                'commission_percent': Decimal('5.00'),
                'winner_dividend_eligible': False,
                'description': 'High-yield commercial pool designed for medium-scale MSME inventory expansions: 20 members, 20 months, ₹15,000 monthly.',
                'rules': 'Auction on 25th. Bank statement reconciliation required.',
                'created_date': '2025-11-01'
            },
            # 5. Diamond Elite ₹10,00,000 Scheme (20 mo, 20 members, ₹50,000/mo)
            {
                'id': 'SCH-DIA-01',
                'name': '10 Lakh Chit',
                'tier': diamond_tier,
                'total_value': Decimal('1000000.00'),
                'duration_months': 20,
                'monthly_installment': Decimal('50000.00'),
                'total_slots': 20,
                'booked_slots': 20,
                'auction_day': 28,
                'auction_time': '07:30 PM',
                'current_month': 2,
                'status': 'active',
                'max_bid_discount': Decimal('20.00'),
                'min_bid_discount': Decimal('5.00'),
                'commission_percent': Decimal('5.00'),
                'winner_dividend_eligible': False,
                'description': 'Premier institutional wealth ticket with highest aggregate dividend discounts: 20 members, 20 months, ₹50,000 monthly.',
                'rules': 'HNI verification required. Automated digital escrow payout.',
                'created_date': '2026-02-01'
            },
        ]

        for s in schemes_data:
            AuctionScheme.objects.update_or_create(id=s['id'], defaults=s)
        self.stdout.write(self.style.SUCCESS(f"Loaded {len(schemes_data)} Schemes."))

        # 4. Member Tickets
        u1 = UserProfile.objects.get(id='usr_01')
        u2 = UserProfile.objects.get(id='usr_02')
        u3 = UserProfile.objects.get(id='usr_03')

        s_brz1 = AuctionScheme.objects.get(id='SCH-BRZ-1L')
        s_gld5 = AuctionScheme.objects.get(id='SCH-GLD-5L')
        s_slv2 = AuctionScheme.objects.get(id='SCH-SLV-02')
        s_gld1 = AuctionScheme.objects.get(id='SCH-GLD-01')
        s_dia1 = AuctionScheme.objects.get(id='SCH-DIA-01')

        tickets_data = [
            {
                'id': 'TKT-BRZ1-01',
                'ticket_number': 1,
                'scheme': s_brz1,
                'user': u1,
                'joined_at_month': 1,
                'has_won_auction': False,
                'won_month': None,
                'won_payout': None,
                'total_months_paid': 2,
                'status': 'active',
                'issued_date': '2026-01-02'
            },
            {
                'id': 'TKT-GLD5-07',
                'ticket_number': 7,
                'scheme': s_gld5,
                'user': u1,
                'joined_at_month': 1,
                'has_won_auction': False,
                'won_month': None,
                'won_payout': None,
                'total_months_paid': 3,
                'status': 'active',
                'issued_date': '2026-01-05'
            },
            {
                'id': 'TKT-SLV2-12',
                'ticket_number': 12,
                'scheme': s_slv2,
                'user': u1,
                'joined_at_month': 1,
                'has_won_auction': False,
                'won_month': None,
                'won_payout': None,
                'total_months_paid': 2,
                'status': 'active',
                'issued_date': '2026-01-15'
            },
            {
                'id': 'TKT-GLD1-04',
                'ticket_number': 4,
                'scheme': s_gld1,
                'user': u1,
                'joined_at_month': 1,
                'has_won_auction': True,
                'won_month': 2,
                'won_payout': Decimal('235000.00'),
                'total_months_paid': 2,
                'status': 'prized',
                'issued_date': '2026-01-10'
            },
            {
                'id': 'TKT-DIA1-02',
                'ticket_number': 2,
                'scheme': s_dia1,
                'user': u1,
                'joined_at_month': 1,
                'has_won_auction': False,
                'won_month': None,
                'won_payout': None,
                'total_months_paid': 1,
                'status': 'active',
                'issued_date': '2026-02-02'
            },
            {
                'id': 'TKT-GLD5-03',
                'ticket_number': 3,
                'scheme': s_gld5,
                'user': u2,
                'joined_at_month': 1,
                'has_won_auction': True,
                'won_month': 1,
                'won_payout': Decimal('375000.00'),
                'total_months_paid': 3,
                'status': 'prized',
                'issued_date': '2026-01-05'
            },
            {
                'id': 'TKT-SLV2-05',
                'ticket_number': 5,
                'scheme': s_slv2,
                'user': u3,
                'joined_at_month': 1,
                'has_won_auction': False,
                'won_month': None,
                'won_payout': None,
                'total_months_paid': 2,
                'status': 'active',
                'issued_date': '2026-01-16'
            }
        ]

        for t in tickets_data:
            Ticket.objects.update_or_create(id=t['id'], defaults=t)
        self.stdout.write(self.style.SUCCESS(f"Loaded {len(tickets_data)} Member Tickets."))

        # 5. Monthly Payments Ledger
        t_brz1_01 = Ticket.objects.get(id='TKT-BRZ1-01')
        t_gld5_07 = Ticket.objects.get(id='TKT-GLD5-07')
        t_slv2_12 = Ticket.objects.get(id='TKT-SLV2-12')
        t_gld1_04 = Ticket.objects.get(id='TKT-GLD1-04')
        t_dia1_02 = Ticket.objects.get(id='TKT-DIA1-02')

        payments_data = [
            # 1 Lakh Scheme Payments (Base: ₹5,000)
            {
                'id': 'PAY-BRZ1-01-M1',
                'ticket': t_brz1_01,
                'scheme': s_brz1,
                'user': u1,
                'month_number': 1,
                'month_name': 'January 2026',
                'base_amount': Decimal('5000.00'),
                'dividend_discount': Decimal('0.00'),
                'net_payable': Decimal('5000.00'),
                'due_date': '2026-01-10',
                'paid_date': '2026-01-09',
                'status': 'PAID',
                'payment_method': 'UPI (GPay)',
                'transaction_ref': 'UPI-SBI-812739182',
                'receipt_number': 'REC-2026-01-088',
                'is_verified': True
            },
            {
                'id': 'PAY-BRZ1-01-M2',
                'ticket': t_brz1_01,
                'scheme': s_brz1,
                'user': u1,
                'month_number': 2,
                'month_name': 'February 2026',
                'base_amount': Decimal('5000.00'),
                'dividend_discount': Decimal('600.00'),
                'net_payable': Decimal('4400.00'),
                'due_date': '2026-02-10',
                'paid_date': '2026-02-08',
                'status': 'PAID',
                'payment_method': 'UPI (PhonePe)',
                'transaction_ref': 'UPI-PP-99283120',
                'receipt_number': 'REC-2026-02-155',
                'is_verified': True
            },
            {
                'id': 'PAY-BRZ1-01-M3',
                'ticket': t_brz1_01,
                'scheme': s_brz1,
                'user': u1,
                'month_number': 3,
                'month_name': 'March 2026',
                'base_amount': Decimal('5000.00'),
                'dividend_discount': Decimal('750.00'),
                'net_payable': Decimal('4250.00'),
                'due_date': '2026-03-10',
                'paid_date': None,
                'status': 'DUE',
                'payment_method': None,
                'transaction_ref': None,
                'receipt_number': None,
                'is_verified': False
            },
            # 5 Lakh Scheme Payments (Base: ₹25,000)
            {
                'id': 'PAY-GLD5-07-M1',
                'ticket': t_gld5_07,
                'scheme': s_gld5,
                'user': u1,
                'month_number': 1,
                'month_name': 'January 2026',
                'base_amount': Decimal('25000.00'),
                'dividend_discount': Decimal('0.00'),
                'net_payable': Decimal('25000.00'),
                'due_date': '2026-01-10',
                'paid_date': '2026-01-08',
                'status': 'PAID',
                'payment_method': 'UPI (GPay)',
                'transaction_ref': 'UPI-AXIS-923847291',
                'receipt_number': 'REC-2026-01-104',
                'is_verified': True
            },
            {
                'id': 'PAY-GLD5-07-M2',
                'ticket': t_gld5_07,
                'scheme': s_gld5,
                'user': u1,
                'month_number': 2,
                'month_name': 'February 2026',
                'base_amount': Decimal('25000.00'),
                'dividend_discount': Decimal('6250.00'),
                'net_payable': Decimal('18750.00'),
                'due_date': '2026-02-10',
                'paid_date': '2026-02-09',
                'status': 'PAID',
                'payment_method': 'HDFC NetBanking',
                'transaction_ref': 'NET-HDFC-88273199',
                'receipt_number': 'REC-2026-02-231',
                'is_verified': True
            },
            {
                'id': 'PAY-GLD5-07-M3',
                'ticket': t_gld5_07,
                'scheme': s_gld5,
                'user': u1,
                'month_number': 3,
                'month_name': 'March 2026',
                'base_amount': Decimal('25000.00'),
                'dividend_discount': Decimal('5250.00'),
                'net_payable': Decimal('19750.00'),
                'due_date': '2026-03-10',
                'paid_date': '2026-03-10',
                'status': 'PAID',
                'payment_method': 'Razorpay / Card',
                'transaction_ref': 'CARD-VISA-4402918',
                'receipt_number': 'REC-2026-03-345',
                'is_verified': True
            },
            {
                'id': 'PAY-GLD5-07-M4',
                'ticket': t_gld5_07,
                'scheme': s_gld5,
                'user': u1,
                'month_number': 4,
                'month_name': 'April 2026',
                'base_amount': Decimal('25000.00'),
                'dividend_discount': Decimal('4500.00'),
                'net_payable': Decimal('20500.00'),
                'due_date': '2026-04-10',
                'paid_date': None,
                'status': 'DUE',
                'payment_method': None,
                'transaction_ref': None,
                'receipt_number': None,
                'is_verified': False
            },
            # 2.0 Lakh Scheme Payments (Base: ₹10,000)
            {
                'id': 'PAY-SLV2-12-M1',
                'ticket': t_slv2_12,
                'scheme': s_slv2,
                'user': u1,
                'month_number': 1,
                'month_name': 'February 2026',
                'base_amount': Decimal('10000.00'),
                'dividend_discount': Decimal('0.00'),
                'net_payable': Decimal('10000.00'),
                'due_date': '2026-02-05',
                'paid_date': '2026-02-04',
                'status': 'PAID',
                'payment_method': 'UPI (PhonePe)',
                'transaction_ref': 'UPI-PP-10928374',
                'receipt_number': 'REC-2026-02-188',
                'is_verified': True
            },
            {
                'id': 'PAY-SLV2-12-M2',
                'ticket': t_slv2_12,
                'scheme': s_slv2,
                'user': u1,
                'month_number': 2,
                'month_name': 'March 2026',
                'base_amount': Decimal('10000.00'),
                'dividend_discount': Decimal('2800.00'),
                'net_payable': Decimal('7200.00'),
                'due_date': '2026-03-05',
                'paid_date': '2026-03-04',
                'status': 'PAID',
                'payment_method': 'UPI (GPay)',
                'transaction_ref': 'UPI-GP-88371923',
                'receipt_number': 'REC-2026-03-492',
                'is_verified': True
            },
            {
                'id': 'PAY-SLV2-12-M3',
                'ticket': t_slv2_12,
                'scheme': s_slv2,
                'user': u1,
                'month_number': 3,
                'month_name': 'April 2026',
                'base_amount': Decimal('10000.00'),
                'dividend_discount': Decimal('2400.00'),
                'net_payable': Decimal('7600.00'),
                'due_date': '2026-04-05',
                'paid_date': None,
                'status': 'OVERDUE',
                'payment_method': None,
                'transaction_ref': None,
                'receipt_number': None,
                'is_verified': False
            },
            # 10.0 Lakh Scheme Payments (Base: ₹50,000)
            {
                'id': 'PAY-DIA1-02-M1',
                'ticket': t_dia1_02,
                'scheme': s_dia1,
                'user': u1,
                'month_number': 1,
                'month_name': 'February 2026',
                'base_amount': Decimal('50000.00'),
                'dividend_discount': Decimal('0.00'),
                'net_payable': Decimal('50000.00'),
                'due_date': '2026-02-28',
                'paid_date': '2026-02-26',
                'status': 'PAID',
                'payment_method': 'RTGS (HDFC Bank)',
                'transaction_ref': 'RTGS-HDFC-0019283',
                'receipt_number': 'REC-2026-02-901',
                'is_verified': True
            },
            {
                'id': 'PAY-DIA1-02-M2',
                'ticket': t_dia1_02,
                'scheme': s_dia1,
                'user': u1,
                'month_number': 2,
                'month_name': 'March 2026',
                'base_amount': Decimal('50000.00'),
                'dividend_discount': Decimal('4500.00'),
                'net_payable': Decimal('45500.00'),
                'due_date': '2026-03-28',
                'paid_date': None,
                'status': 'DUE',
                'payment_method': None,
                'transaction_ref': None,
                'receipt_number': None,
                'is_verified': False
            },
            # 3.0 Lakh Scheme Payments (Base: ₹15,000)
            {
                'id': 'PAY-GLD1-04-M1',
                'ticket': t_gld1_04,
                'scheme': s_gld1,
                'user': u1,
                'month_number': 1,
                'month_name': 'January 2026',
                'base_amount': Decimal('15000.00'),
                'dividend_discount': Decimal('0.00'),
                'net_payable': Decimal('15000.00'),
                'due_date': '2026-01-25',
                'paid_date': '2026-01-24',
                'status': 'PAID',
                'payment_method': 'UPI (GPay)',
                'transaction_ref': 'UPI-SBI-77281923',
                'receipt_number': 'REC-2026-01-301',
                'is_verified': True
            },
            {
                'id': 'PAY-GLD1-04-M2',
                'ticket': t_gld1_04,
                'scheme': s_gld1,
                'user': u1,
                'month_number': 2,
                'month_name': 'February 2026',
                'base_amount': Decimal('15000.00'),
                'dividend_discount': Decimal('2200.00'),
                'net_payable': Decimal('12800.00'),
                'due_date': '2026-02-25',
                'paid_date': '2026-02-24',
                'status': 'PAID',
                'payment_method': 'HDFC NetBanking',
                'transaction_ref': 'NET-HDFC-9938120',
                'receipt_number': 'REC-2026-02-412',
                'is_verified': True
            },
            {
                'id': 'PAY-GLD1-04-M3',
                'ticket': t_gld1_04,
                'scheme': s_gld1,
                'user': u1,
                'month_number': 3,
                'month_name': 'March 2026',
                'base_amount': Decimal('15000.00'),
                'dividend_discount': Decimal('1500.00'),
                'net_payable': Decimal('13500.00'),
                'due_date': '2026-03-25',
                'paid_date': None,
                'status': 'DUE',
                'payment_method': None,
                'transaction_ref': None,
                'receipt_number': None,
                'is_verified': False
            }
        ]

        # Payments for the two other seeded members so total_months_paid is backed by real rows.
        # Dividend schedule mirrors the other tickets in the same scheme.
        t_gld5_03 = Ticket.objects.get(id='TKT-GLD5-03')
        t_slv2_05 = Ticket.objects.get(id='TKT-SLV2-05')
        def _pay(pid, tkt, sch, usr, m, mname, div, due, paid, status, method=None, ref=None, rec=None):
            base = sch.monthly_installment
            return {
                'id': pid, 'ticket': tkt, 'scheme': sch, 'user': usr, 'month_number': m,
                'month_name': mname, 'base_amount': base, 'dividend_discount': Decimal(div),
                'net_payable': base - Decimal(div), 'due_date': due, 'paid_date': paid,
                'status': status, 'payment_method': method, 'transaction_ref': ref,
                'receipt_number': rec, 'is_verified': status == 'PAID',
            }
        payments_data += [
            _pay('PAY-PRIYA-M1', t_gld5_03, s_gld5, u2, 1, 'January 2026', '0.00', '2026-01-10', '2026-01-08', 'PAID', 'UPI (GPay)', 'UPI-ICICI-550192837', 'REC-2026-01-110'),
            _pay('PAY-PRIYA-M2', t_gld5_03, s_gld5, u2, 2, 'February 2026', '6250.00', '2026-02-10', '2026-02-09', 'PAID', 'UPI (PhonePe)', 'UPI-PP-66120493', 'REC-2026-02-117'),
            _pay('PAY-PRIYA-M3', t_gld5_03, s_gld5, u2, 3, 'March 2026', '5250.00', '2026-03-10', '2026-03-09', 'PAID', 'NEFT (ICICI)', 'NEFT-ICICI-771625', 'REC-2026-03-119'),
            _pay('PAY-PRIYA-M4', t_gld5_03, s_gld5, u2, 4, 'April 2026', '4500.00', '2026-04-10', None, 'DUE'),
            _pay('PAY-VIKRAM-M1', t_slv2_05, s_slv2, u3, 1, 'February 2026', '0.00', '2026-02-05', '2026-02-03', 'PAID', 'UPI (GPay)', 'UPI-GP-45120938', 'REC-2026-02-190'),
            _pay('PAY-VIKRAM-M2', t_slv2_05, s_slv2, u3, 2, 'March 2026', '2800.00', '2026-03-05', '2026-03-04', 'PAID', 'UPI (GPay)', 'UPI-GP-45987120', 'REC-2026-03-494'),
            _pay('PAY-VIKRAM-M3', t_slv2_05, s_slv2, u3, 3, 'April 2026', '2400.00', '2026-04-05', None, 'OVERDUE'),
        ]

        for p in payments_data:
            MonthlyPayment.objects.update_or_create(id=p['id'], defaults=p)
        self.stdout.write(self.style.SUCCESS(f"Loaded {len(payments_data)} Monthly Payment Ledger Entries."))

        # 6. Live Auction Rounds for All Schemes
        rounds_seed = [
            {
                'id': 'ROUND-BRZ1-M3',
                'scheme': s_brz1,
                'month_number': 3,
                'highest_discount_bid': Decimal('14000.00'),
                'leader_name': 'Neha Iyer',
                'time_left_seconds': 280,
                'is_active': True,
                'bids': [
                    {'bidder_name': 'Rahul Sharma', 'discount_amount': Decimal('8000.00'), 'relative_time': '5m ago'},
                    {'bidder_name': 'Sunil Verma', 'discount_amount': Decimal('11000.00'), 'relative_time': '3m ago'},
                    {'bidder_name': 'Neha Iyer', 'discount_amount': Decimal('14000.00'), 'relative_time': '1m ago'},
                ]
            },
            {
                'id': 'ROUND-GLD5-M4',
                'scheme': s_gld5,
                'month_number': 4,
                'highest_discount_bid': Decimal('90000.00'),
                'leader_name': 'Karthik Menon',
                'time_left_seconds': 342,
                'is_active': True,
                'bids': [
                    {'bidder_name': 'Ananya Deshmukh', 'discount_amount': Decimal('70000.00'), 'relative_time': '4m ago'},
                    {'bidder_name': 'Rajesh Nair', 'discount_amount': Decimal('80000.00'), 'relative_time': '2m ago'},
                    {'bidder_name': 'Karthik Menon', 'discount_amount': Decimal('90000.00'), 'relative_time': '1m ago'},
                ]
            },
            {
                'id': 'ROUND-SLV2-M3',
                'scheme': s_slv2,
                'month_number': 3,
                'highest_discount_bid': Decimal('35000.00'),
                'leader_name': 'Rajesh Nair',
                'time_left_seconds': 410,
                'is_active': True,
                'bids': [
                    {'bidder_name': 'Sanjay Gupta', 'discount_amount': Decimal('25000.00'), 'relative_time': '6m ago'},
                    {'bidder_name': 'Pooja Hegde', 'discount_amount': Decimal('30000.00'), 'relative_time': '3m ago'},
                    {'bidder_name': 'Rajesh Nair', 'discount_amount': Decimal('35000.00'), 'relative_time': 'Just now'},
                ]
            },
            {
                'id': 'ROUND-GLD1-M3',
                'scheme': s_gld1,
                'month_number': 3,
                'highest_discount_bid': Decimal('48000.00'),
                'leader_name': 'Amit Patel',
                'time_left_seconds': 520,
                'is_active': True,
                'bids': [
                    {'bidder_name': 'Kavita Reddy', 'discount_amount': Decimal('35000.00'), 'relative_time': '8m ago'},
                    {'bidder_name': 'Amit Patel', 'discount_amount': Decimal('48000.00'), 'relative_time': '2m ago'},
                ]
            },
            {
                'id': 'ROUND-DIA1-M2',
                'scheme': s_dia1,
                'month_number': 2,
                'highest_discount_bid': Decimal('100000.00'),
                'leader_name': 'Meera Kapoor',
                'time_left_seconds': 600,
                'is_active': True,
                'bids': [
                    {'bidder_name': 'Deepak Singhania', 'discount_amount': Decimal('75000.00'), 'relative_time': '10m ago'},
                    {'bidder_name': 'Meera Kapoor', 'discount_amount': Decimal('100000.00'), 'relative_time': '3m ago'},
                ]
            }
        ]

        for r in rounds_seed:
            bids_list = r.pop('bids')
            round_obj, _ = AuctionRound.objects.update_or_create(id=r['id'], defaults=r)
            AuctionBid.objects.filter(round=round_obj).delete()
            for b in bids_list:
                tk = Ticket.objects.filter(scheme=round_obj.scheme, user__name=b['bidder_name'], has_won_auction=False).first()
                AuctionBid.objects.create(round=round_obj, ticket=tk, bidder=tk.user if tk else None, **b)

        # 7. Reconcile derived data so counters, ledger and audit records agree with the rows they summarise
        from api.models import RazorpayQRCode
        from api.views import calculate_auction_distribution

        # 7a. Remove rounds left by older seeds under wrong months
        AuctionRound.objects.filter(id__in=['ROUND-GLD1-M5', 'ROUND-DIA1-M1']).delete()

        # 7b. Ledger entries must describe the payment's real state; drop stale ones from a previous run
        stale_ledger = 0
        for entry in PaymentLedgerEntry.objects.select_related('payment'):
            if entry.entry_type != 'DIVIDEND_ADJUSTMENT' and entry.new_status != entry.payment.status:
                entry.delete()
                stale_ledger += 1
        RazorpayQRCode.objects.exclude(status='paid').filter(payment__status='PAID').update(status='closed')
        if stale_ledger:
            self.stdout.write(f"Removed {stale_ledger} stale ledger entr{'y' if stale_ledger == 1 else 'ies'}.")

        # 7c. Auction records for the wins that are recorded on tickets (winner, month and payout are known)
        admin_profile = UserProfile.objects.get(id='adm_01')
        for tkt in Ticket.objects.filter(has_won_auction=True, won_month__isnull=False, won_payout__isnull=False).select_related('scheme', 'user'):
            sch = tkt.scheme
            discount = sch.total_value - tkt.won_payout
            eligible = max(1, sch.total_slots - tkt.won_month)
            d = calculate_auction_distribution(sch, discount, eligible)
            AuctionRecord.objects.update_or_create(
                id=f"REC-AUC-{sch.id}-M{tkt.won_month}",
                defaults={
                    'scheme': sch, 'month_number': tkt.won_month,
                    'winner_ticket': tkt, 'winner_user': tkt.user,
                    'total_chit_value': d['total_chit_value'], 'winning_discount': d['winning_discount'],
                    'organizer_commission': d['commission'], 'distributable_dividend': d['distributable_dividend'],
                    'eligible_members_count': d['eligible_count'], 'dividend_per_member': d['dividend_per_member'],
                    'rounding_remainder': d['remainder'], 'net_prize_payout': d['winner_payout'],
                    'concluded_by': admin_profile,
                },
            )

        # 7d. Derived counters computed from real rows (never hardcoded)
        for tkt in Ticket.objects.all():
            tkt.total_months_paid = MonthlyPayment.objects.filter(ticket=tkt, status='PAID').count()
            tkt.status = 'prized' if tkt.has_won_auction else 'active'
            tkt.save()
        for sch in AuctionScheme.objects.all():
            sch.booked_slots = Ticket.objects.filter(scheme=sch).count()
            if sch.status == 'enrolling' and not AuctionRecord.objects.filter(scheme=sch).exists():
                sch.current_month = 1
            sch.save()

        # 7e. Link each live round's leader to a real ticket where the leader is a seeded member
        for rnd in AuctionRound.objects.filter(is_concluded=False):
            top = rnd.bids.order_by('-discount_amount').first()
            if top:
                rnd.highest_discount_bid = top.discount_amount
                rnd.leader_name = top.bidder_name
                rnd.leader_ticket = top.ticket
                rnd.save()

        self.stdout.write(self.style.SUCCESS("Database seeding completed successfully!"))