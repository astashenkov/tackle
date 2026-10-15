import { render } from 'preact';
import '@fontsource-variable/inter';
import './styles/app.css';
import { lang, loadLocale } from './lib/i18n';
import { interceptLinks } from './lib/router';
import { App } from './app';

await loadLocale(lang.value).catch(() => {});
interceptLinks();
render(<App />, document.getElementById('app')!);
