# Infrastructura și costurile

4 septembrie 2026. Sumele sunt în dolari, fără TVA.

Azi plătim 0 pe lună. Trei servicii, toate pe planul gratuit. Nu e o economie, e o datorie.

## Ce avem

| Serviciu | La ce ne folosește | Plan | Limitele planului gratuit |
|---|---|---|---|
| Vercel | Aplicația și rutele de API. Plus memento-urile zilnice, la 06:00. | Hobby, gratuit | Doar uz personal, nu comercial. Sarcinile programate rulează o singură dată pe zi, la oră aproximativă. |
| Supabase | Baza de date, conturile, documentele. | Free | 500 MB bază de date, 1 GB fișiere, 5 GB trafic, 50.000 de utilizatori activi lunar. Fără backup-uri. Proiectul se suspendă după 7 zile fără trafic. |
| Resend | Emailurile către clienți, de pe notificari@vorbaretul.ro. | Free | 3.000 de emailuri pe lună și cel mult 100 pe zi. |
| GitHub | Codul, pe un cont personal. | Gratuit | Nicio limită care să ne încurce. |

Domeniul propriu încă nu există.

## Ce ne blochează

1. Vercel Hobby interzice folosirea comercială. Nu e o îmbunătățire de făcut, e o condiție.
2. Supabase Free se suspendă după 7 zile fără trafic, iar cei 1 GB de fișiere se termină pe la 12 proiecte duse până la capăt.
3. Nu avem un export complet al bazei de date. Nu o putem reface dacă se pierde și nu putem porni o instanță pentru altă firmă.

Mai mic, dar real: Resend se oprește la 100 de emailuri pe zi, iar clienții primesc notificări de pe un domeniu pe care nu-l recunosc.

## Cât ar trebui să plătim

| | Minim | Recomandat |
|---|---:|---:|
| Vercel Pro | 20 USD | 20 USD |
| Supabase Pro | 25 USD | 25 USD |
| Resend Pro | — | 20 USD |
| Domeniu | — | 1,5 USD |
| Total lunar | 45 USD | 66,5 USD |

Aproximativ 210, respectiv 310 lei.

## La 50 de clienți

Cifrele de mai jos sunt estimări, nu măsurători. Pornesc de la raportul de azi, un proiect pe client. După o perioadă în care platforma rulează cu clienți reali, citim consumul din panourile Supabase și Resend și punem cifre măsurate în locul lor.

| | Consum | Inclus în Pro |
|---|---|---|
| Fișiere | 4,3 GB, sau 8-9 GB cu revizii | 100 GB |
| Bază de date | sub 100 MB | 8 GB |
| Notificări și emailuri | în jur de 4.600 pe lună, cu vârfuri peste 150 pe zi | 50.000 |

Totul intră lejer, cu marjă mare — și marja e tocmai ce ne permite să pornim de la estimări. Costul rămâne 66,5 USD pe lună. Singura schimbare față de tabelul de mai sus e Resend: la volumul ăsta probabil depășim și plafonul lunar de 3.000, și pe cel zilnic de 100, deci Pro devine obligatoriu. Aici estimarea e cea mai slabă, fiindcă notificările din aplicație și emailurile chiar trimise sunt două volume diferite. O lămurim cu prima lună de trafic real.

## A doua firmă

Instanță separată: același cod, bază de date proprie. Costă în plus circa 11,5 USD pe lună, atât. Vercel se plătește pe dezvoltator, nu pe proiect, iar al doilea proiect Supabase costă 10 USD, nu 25.

Scump e lucrul, nu banii: fiecare modificare de structură se aplică de două ori. Rezonabil până pe la patru-cinci firme.

Prețuri de listă: [Supabase](https://supabase.com/pricing), [Vercel](https://vercel.com/docs/plans/hobby), [Resend](https://resend.com/pricing).
