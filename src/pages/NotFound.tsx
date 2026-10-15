import { Compass } from 'lucide-preact';
import { t } from '../lib/i18n';
import { EmptyState, PageHeader } from '../components/PageHeader';

export function NotFound() {
  return (
    <div class="page">
      <PageHeader title={t('notFound.title')} />
      <EmptyState icon={<Compass size={28} />} title={t('notFound.title')} text={t('notFound.text')}>
        <a class="btn primary" href="/">
          {t('notFound.home')}
        </a>
      </EmptyState>
    </div>
  );
}
