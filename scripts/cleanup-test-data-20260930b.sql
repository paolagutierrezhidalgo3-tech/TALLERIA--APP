-- One-off cleanup of the single test customer/vehicle/request/conversation/
-- appointment created during the 30 Sept 2026 manual production review of
-- the calendar click-to-create flow and the agenda search/status filters
-- (blocks G and I). Not a schema migration -- deliberately not added under
-- supabase/migrations/. Scoped to exactly these 5 known ids, none of which
-- are referenced by anything else real. Deletes in FK-safe order.
begin;

delete from appointments where id in (
  'c226d370-34f6-43ac-928a-e52daa68eecc'
);

delete from requests where id in (
  '377e83ed-305a-43d4-b717-41deb61b24b6'
);

delete from conversations where id in (
  'ac54aa3c-c1ef-4352-b005-3229365c0270'
);

delete from vehicles where id in (
  'e4d2ead7-1eb4-4314-a6c8-2b1c1b0ee649'
);

delete from customers where id in (
  '65082229-cedc-475a-bcd9-65783dde1364'
);

commit;
