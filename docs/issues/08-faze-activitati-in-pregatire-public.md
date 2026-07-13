<!-- labels: enhancement,security -->
# Faze și activități „În pregătire" / „Public"

## Context
Toate fazele și activitățile unui proiect sunt vizibile clientului imediat ce sunt create. Consultanții nu pot pregăti structura „în culise" înainte de a o expune clientului.

## Cerință
- O fază sau o activitate poate fi păstrată în starea **În pregătire**, vizibilă numai administratorului și consultantului.
- Clientul nu trebuie să o vadă în proiect, căutare, calendar sau notificări.
- La **publicare**, elementul devine vizibil clientului, iar clientul primește o **notificare prin email**.

## Criterii de acceptare
- [ ] Fazele și activitățile au starea `În pregătire` sau `Public`; starea este vizibilă (badge) pentru admin/consultant.
- [ ] Clientul NU vede elementele „În pregătire" în: pagina proiectului, căutare, calendar, notificări, Drive, procente de progres.
- [ ] Publicarea unei faze/activități o face vizibilă clientului și declanșează notificare email către client.
- [ ] O activitate dintr-o fază „În pregătire" este ascunsă clientului indiferent de starea proprie (moștenire).
- [ ] Cererile de documente aflate sub o activitate „În pregătire" sunt ascunse clientului (inclusiv la descărcare directă prin API, nu doar în UI).
- [ ] Publicarea/depublicarea este înregistrată în audit.

## Note tehnice
- **Migrare SQL**: coloană `visibility` (`draft` / `published`) pe `project_phases` și `project_activities`.
- **Risc principal — scurgere de date**: autorizarea este la nivel de API (service-role bypass RLS), deci fiecare endpoint citit de client trebuie să filtreze elementele nepublicate. Recomandare fermă: un helper comun „client view" (un singur loc care aplică filtrarea) folosit de toate rutele client-facing, în loc de filtre repetate în fiecare rută.
- Datele derivate trebuie și ele corectate: progresul (`progress_percent`, numărători de activități) nu trebuie să includă elementele nepublicate când e afișat clientului.
- **Întrebare deschisă din documentul de cerințe**: se dorește starea În pregătire/Public și pentru cererile de documente? **Recomandare: da**, prin moștenire de la activitate + flag propriu pe cerere (altfel publicarea unei activități expune cererile încă în lucru).

## Dependențe
- Trebuie implementat **înaintea**: *Căutare în proiect*, *Calendar*, *Centru de notificări* (toate trebuie să respecte vizibilitatea).
- Notificarea email la publicare depinde de: *Email direct din platformă* / *Centru unic de notificări*.
- Migrarea SQL se grupează cu etapa de fundații.
