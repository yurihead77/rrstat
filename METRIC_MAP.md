# Карта показателей вкладки «Статистика  - сайт»

| Строка | Название | Данные / формула нового представления | Проверка перед приёмкой |
|---|---|---|---|
| 3 | Пользователи | `ym:s:users`, один итог за неделю | Сверить с однородным отчетом посещаемости |
| 4 | Новые пользователи | `ym:s:newUsers`, **не** старая формула с ручным процентом | Исторические значения 2026 не считать эталоном |
| 5 | Визиты | `ym:s:visits` | Сверить |
| 6 | Визитов на пользователя | `visits/users` | Деление на ноль → пусто |
| 7 | Просмотры | `ym:s:pageviews` | Сверить |
| 8 | Глубина | `ym:s:pageDepth` | Вывод 2 знака, хранение API без округления |
| 9 | Время на сайте | `ym:s:avgVisitDurationSeconds` / 86400 для формата `[h]:mm:ss` | API секунды не заменять CSV-целым значением |
| 10 | Отказы | `ym:s:bounceRate` / 100 | API процентные пункты → доля |
| 12 | Доля Android среди Android+iOS | `android_users / (android_users+ios_users)` | Это не доля всех мобильных устройств |
| 13–15 | Android | `ym:s:visits/users/newUsers`, группировка OS root **в mobile+tablet** | Проверить подпись группы Android в живом API |
| 17 | Доля iOS среди Android+iOS | `ios_users / (android_users+ios_users)` | То же ограничение знаменателя |
| 18–20 | iOS | `ym:s:visits/users/newUsers`, OS root **в mobile+tablet** | Проверить подпись группы iOS, отдельность iPadOS |
| 22 | Доля mobile+tablet | `mobile_users / users` | Недельные уникальные напрямую из фильтрованного итога |
| 23–25 | Mobile+tablet | `ym:s:visits/users/newUsers` с `deviceCategory=.('mobile','tablet')` | **Не** суммировать уникальных пользователей по строкам ОС/категориям |
| 28 | Organic | `ym:s:users`, сгруппированные `ym:s:trafficSource`, `id=organic`, атрибуция `last` | Сверить модель атрибуции источников |
| 29 | Direct | Аналогично `id=direct` | То же |
| 30 | Referral | Аналогично `id=referral` | То же |
| 31 | Social | Аналогично `id=social` | То же |
| 34 | `/` | `ym:pv:pageviews`, фильтр `URLPath=='/'` | Без `?` и `#` |
| 35 | `/stations/` | `ym:pv:pageviews`, `URLPath` строго `/stations/` | Слэш в конце значим |
| 36 | `/station/rus` | `ym:pv:pageviews`, `URLPath` строго `/station/rus` | Уточнить редиректы / завершающий слэш |
| 37 | `/event/` | `ym:pv:pageviews`, `URLPath` строго `/event/` | Не все URL вида `/event/*` |
| 38 | `Megamix /podcast/15761` | `ym:pv:pageviews`, `URLPath` строго `/podcast/15761` | Не все страницы подкастов |
| 39 | `Свежаки /chart/newest` | `ym:pv:pageviews`, `URLPath` строго `/chart/newest` | Слэши и параметры |
| 40 | `Суперчарт /chart/superchart` | `ym:pv:pageviews`, `URLPath` строго `/chart/superchart` | Слэши и параметры |
| 41 | `/station/deep` | `ym:pv:pageviews`, `URLPath` строго `/station/deep` | Слэши и параметры |
| 42 | `/chart/clubchart` | `ym:pv:pageviews`, `URLPath` строго `/chart/clubchart` | Слэши и параметры |
| 43 | `/radio/stations/?st=rr` | `ym:pv:pageviews`, **URLPathFull** строго `/radio/stations/?st=rr` | В отличие от остальных, учитывается query string; иные параметры исключаются |
| 46 | Доля десктопов | `(users-mobile_users)/users` | Арифметический остаток, **не** независимые desktop unique |
| 47 | Доля mobile | `mobile_users/users` | Повторяет 22 |
| 49 | Android: доля от всех / относительная | `android_users/users` в колонке недели, `android_users/(android_users+ios_users)` в соседней | Соседняя колонка — **не** изменение к прошлой неделе |
| 50 | iOS: доля от всех / относительная | `ios_users/users` в колонке недели, `ios_users/(android_users+ios_users)` в соседней | То же |

**Колонки:** неделя — числовое значение, справа — изменение к непосредственно предшествующей календарной неделе по формуле `current/previous-1` (если предыдущая неделя есть и её показатель не ноль). В строках 49–50 правый столбец означает «относительно» и содержит долю внутри Android+iOS.

**Статус:** карта соответствует структуре и формулам исходного листа, но технические фильтры и группировки новых API-запросов проверены пока только на mock-ответах. Не объявлять значения новых сегментов полностью сопоставимыми с историческими без живого preview и сверки двух периодов.
