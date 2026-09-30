-- One-off cleanup of test data created during the 30 Sept 2026 real-production
-- end-to-end verification of the "aviso de solicitudes nuevas" fix, plus the
-- 5 leftover test requests from the 29 Sept 2026 session that surfaced the
-- original bug. Not a schema migration -- deliberately not added under
-- supabase/migrations/. Scoped to exactly the 12 known request ids (and their
-- dedicated fake customer/vehicle/conversation rows, none of which are
-- referenced by anything else real). Deletes in FK-safe order. Leaves
-- audit_events untouched, same as customer_anonymize's own erasure command.
begin;

delete from requests where id in (
  '30e409f0-7ce7-47d7-a11d-c65f41182678',
  '99031626-dd80-4959-9dd5-d469db22db82',
  'ca079063-85bb-48e5-bfe9-3f5864129a08',
  '40e4c2b0-2878-451d-80c5-5f41e6468a65',
  'bfb48590-5088-4129-9395-43ccfe2761de',
  '6a6d9554-b50a-4f1b-9466-34118408504d',
  '042f701d-bf23-47ec-9dcd-4acce6763842',
  '36abccd4-c8f9-46c2-b755-bc458dfab4d6',
  '74d1bb0f-9af3-4d87-91ab-4a1d46521904',
  '877da02d-3f9d-4a85-af1e-25c8af2a41f4',
  '63f5a44e-7731-4eba-8115-0a58928c8ace',
  'd261011f-ffc5-42d3-a0b1-da88a3112fa3'
);

delete from conversations where id in (
  'a2301d3c-5aba-457a-8460-547112f6728d',
  'ce4610ad-778b-4218-80ae-cc449456a523',
  'eeebf393-ab04-4d2c-922e-39c3a85c3188',
  'dc2e5cd6-cf9d-43d2-92f0-251d43aadaa8',
  '3664babd-8178-40e1-bc06-55bcc103a130',
  'e88dfef6-cc4e-44f6-a2a0-b543098c198c',
  '3ecf2db7-cce6-4399-af32-017cc4e3a210',
  'c8177e39-cf8b-4c64-8e34-8d94b3958f9a',
  'b16fbcb4-d0d6-4892-b6c5-ef461929321d',
  'e6860ad2-4679-4de5-b0e7-8e786e4f4c45',
  'facc7f50-38bc-4928-8dd6-711ebb7ce5a6',
  'b0857db3-c3d0-4a6f-ac6e-3b86d2079378'
);

delete from vehicles where id in (
  'ffa196fa-efc6-4b79-9f42-f5a9895ef729',
  '6cfee61e-4dab-4ef0-98d0-1e645bae2351',
  'cade99a3-80be-4a6e-ba1f-2f2201211af9',
  'cbf04f9c-05f7-487a-a529-db78e4b87a89',
  '2082532a-5440-4188-8cfe-8b8e855495f4',
  'db8faf65-bbb5-4d3f-9be8-d89a79cc500b',
  '11110c40-2456-4ac9-b3bf-b0dd0d5e3d40',
  'a0ebdb11-96c1-4a8a-97b9-cbb296946bd4',
  '78c22aa9-103a-4bb4-9c52-c56336e7e203',
  '5cbb2c77-05b9-4576-9740-d58694b5925c',
  '9b015438-279f-4d9b-abd1-8629a1de2ea7',
  '6e6d54b8-6907-43e7-8438-13c7d2f90974'
);

delete from customers where id in (
  'd3e51c71-b29e-4fc8-943d-961aab3347dd',
  '77f8c749-ff86-4048-97fb-f6d538ad5c46',
  '52c1a818-1968-4848-9f9b-182483e85fae',
  'cc8c7473-fc62-4ba1-9a3e-bd2f8d1fcc2c',
  '62e0bbce-f207-4d21-b208-49479656aa71',
  '4f2f6364-ce8c-43e4-8546-d933743a85e3',
  'f831964d-b4a6-4f73-a690-5909c9eea6d7',
  '20c104c8-c778-42bb-af7a-14f723cba809',
  '397653b9-db86-41a3-89ed-e52d53ff71df',
  'a7f96de7-d167-4879-aa1c-d87f39e66b9f',
  '33e6c7bc-eb2e-4ec2-b664-b9624201891c',
  '016b0479-378e-43fe-ab19-94b3119e5594'
);

commit;
