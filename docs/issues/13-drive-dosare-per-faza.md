<!-- labels: enhancement,ux -->
# Drive organizat pe dosare pentru fiecare fază

## Context
Drive-ul proiectului (`components/DriveFilesView.tsx`) afișează fișierele fără o grupare pe structura proiectului, ceea ce îngreunează găsirea documentelor unei faze.

## Cerință
- În Drive trebuie să existe **câte un dosar pentru fiecare fază** a proiectului.
- Dosarele se afișează **în aceeași ordine ca fazele proiectului**.
- Documentele fiecărei faze se păstrează în dosarul corespunzător.

## Criterii de acceptare
- [ ] Drive-ul afișează un dosar per fază, în ordinea `order_index` a fazelor.
- [ ] Fișierele apar în dosarul fazei de care aparține cererea lor de document.
- [ ] Reordonarea fazelor în proiect se reflectă în ordinea dosarelor.
- [ ] Fișierele care nu aparțin unei faze (dacă există) apar într-un dosar generic (ex. „Altele").
- [ ] Pentru rolul de client, dosarele fazelor „În pregătire" nu sunt vizibile.

## Note tehnice
- **Recomandare: dosare virtuale, nu restructurare fizică în Storage.** Relația există deja în date: fișier → cerere de document → activitate → fază. Gruparea se face la afișare; nu se mută obiecte în Supabase Storage (operațiune riscantă și inutilă).
- Interacționează cu *Clientul vede numai ultima versiune*: în Drive, versiunile vechi rămân vizibile ca istoric pentru admin/consultant.

## Dependențe
- De proiectat împreună cu: *Refacerea paginii unui proiect*.
- Trebuie să respecte: *Faze și activități În pregătire/Public*, *Clientul vede numai ultima versiune*.
