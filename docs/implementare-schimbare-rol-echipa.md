# Schimbarea sigură a rolului — implementare și verificare

Data: 2 noiembrie 2026. Branch: `feat/safe-role-switch`.

## Baza și scope-ul

Baza a fost adusă prin fast-forward de la `92f2f60` la `f5a5fa3`, versiunea
disponibilă local a `origin/main`, pentru dependențele #110 și #133.
Nu s-a făcut fetch, PR sau deploy. Planul de referință este
`docs/plan-schimbare-rol-echipa.md`; secțiunile 7 și 8 sunt excluse.

Implementarea a fost împărțită între trei subagenți GPT-6.1 Terra, medium,
pentru SQL, API și UI, apoi revizuită și verificată de orchestrator.

## Comportament implementat

- Rolul se schimbă din pagina utilizatorului, între administrator și consultant.
  Conversiile către/de la client sunt refuzate în API și SQL; retrimiterea
  rolului existent al clientului și editarea firmei/CIF-ului rămân permise.
- Dialogul verifică impactul pentru rol, nivel și dezactivare, arată blocajele,
  istoricul, totalurile și linkurile de remediere. Erorile nu permit confirmarea;
  revenirea din altă filă și conflictele determină reverificarea.
- Revenirea în consultant cere specializare și nivel explicit, implicit junior.
  Profilul rezultat este validat complet; schimbarea propriului rol actualizează
  sesiunea din UI și redirecționează în afara administrării.
- Migrarea nouă clasifică atribuțiile directe și moștenite, ciornele, documentele
  în verificare, istoricul și șabloanele. Conturile noi pending își păstrează
  calea de finalizare; datele vechi nu sunt șterse sau transferate automat.
- Confirmarea recalculează impactul în tranzacție. Profilul și auditul se salvează
  împreună, inclusiv IP/user-agent; notificarea schimbării emailului rămâne după
  succes. RPC-ul anterior rămâne compatibil și auditat, iar implementarea internă
  fără audit nu este executabilă de `service_role`.
- Protecțiile acoperă seniorii, membrii, atribuirea/publicarea, redeschiderea și
  eligibilitatea șabloanelor. Scrierile participă la ordinea comună a blocărilor,
  inclusiv RPC-urile existente care luau blocări de rând înainte de scriere.
- Pe proiecte încheiate, administratorul poate pregăti strict echipa și
  responsabilitățile pentru redeschidere, folosind `prepare_reopen: true`.
  Celelalte controale de editare rămân închise.

## Verificări

| Verificare | Rezultat |
|---|---|
| Suita unitară, inclusiv rutele transpiliate cu dependențe controlate | 550 teste trecute |
| TypeScript | Trecut |
| ESLint | Zero erori; trei avertismente existente în chat/testele de design |
| Build Next.js 16.4.3 | Trecut |
| UI Playwright cu API/Auth simulate, desktop și telefon | Șase teste trecute; verificare vizuală efectuată |
| Contractul de audit, read-only pe Docker local | Trecut |
| Reconstrucția migrărilor pe proiect Docker aleatoriu, fără seed | 29 de migrări |
| SQL cu rollback | Roluri, profil, audit, permisiuni, istoric, senior inactiv/pending, redeschidere proiect/fază/activitate, import eligibil/neeligibil fără salvare parțială |
| Două sesiuni SQL concurente | Patru scenarii trecute: atribuire vs rol, doi seniori eliminați, retrogradare vs dezactivare, ultimii admini |
| Advisori de securitate pe baza temporară | Zero erori; zece avertismente `search_path` pentru funcții existente |

`npm run db:validate` execută testele SQL, inventarul read-only și probele de
concurență înainte să elimine proiectul temporar. Timpul de pornire al DB-ului
temporar este de zece minute pentru mașinile Docker lente; verificările de
sănătate și aserțiunile de izolare rămân obligatorii.

Inventarul `scripts/role-change-anomalies.sql` a fost executat read-only pe
baza Docker locală existentă: zero anomalii după excluderea ciornelor care pot
fi neatribuite. Nu au fost inventariate sau modificate date hosted.

## Limitele verificării

Testele de interfață simulează API/Auth. Verificările API execută codul rutelor
cu dependențe controlate; verificările SQL și de concurență folosesc PostgreSQL
real, izolat. Nu a fost rulat un flux complet browser → API → Auth → DB cu
migrarea nouă. Ulterior, la raportarea erorii de încărcare a impactului,
migrarea a fost aplicată și pe baza Docker principală locală, fără reset;
apelul real al inventarului a fost verificat și schema PostgREST reîncărcată.
Verificările după aplicare și livrarea rămân în etapa exclusă din această cerere.
