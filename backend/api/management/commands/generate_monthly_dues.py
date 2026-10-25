from django.core.management.base import BaseCommand

from api.dues import generate_monthly_dues, sync_payment_statuses


class Command(BaseCommand):
    help = (
        'Create the missing monthly installments (current + next month) for every active ticket '
        'and refresh OVERDUE / DUE / UPCOMING statuses from today\'s date. Safe to run repeatedly.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--due-day', type=int, default=None,
                            help='Force new installments to fall due on this day of the month (1-28).')

    def handle(self, *args, **opts):
        created = generate_monthly_dues(due_day=opts.get('due_day'))
        changed = sync_payment_statuses()
        self.stdout.write(self.style.SUCCESS(
            f'Created {created} installment(s); updated status on {changed} installment(s).'))