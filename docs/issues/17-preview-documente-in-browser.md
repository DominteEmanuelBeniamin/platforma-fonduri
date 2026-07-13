<!-- labels: enhancement,ux -->
# Preview al documentelor direct în browser

## Context
În prezent fișierele se descarcă obligatoriu; PDF-urile și imaginile nu pot fi vizualizate direct în browser.

## Cerință
- **PDF-urile și imaginile** se deschid într-un **tab nou** al browserului, fără descărcare obligatorie.
- Butonul de **descărcare rămâne disponibil**.
- Formatele care nu pot fi afișate în browser se descarcă în continuare.

## Criterii de acceptare
- [ ] Pentru PDF și imagini există acțiune „Deschide" care afișează fișierul într-un tab nou.
- [ ] Butonul „Descarcă" rămâne disponibil pentru toate formatele.
- [ ] Formatele neafișabile (Word, Excel, arhive etc.) au doar acțiunea de descărcare.
- [ ] Comportamentul e consistent peste tot unde apar fișiere: cereri de documente, Drive, (ulterior) chat.

## Note tehnice
- Supabase Storage: la generarea URL-ului semnat se controlează `Content-Disposition` — `inline` pentru preview, `attachment` pentru descărcare (parametrul `download` din `createSignedUrl`).
- Decizia inline/attachment se ia pe baza `mime_type` (deja stocat pe fișiere).
- Modificare mică în rutele `signed-download` + butoane în UI. Efort mic — candidat pentru prima etapă (remedieri rapide).

## Dependențe
- Fără dependențe.
