export interface BuiltInPlatform {
  id: string;
  name: string;
  slug: string;
  tipMinerRoundUuid: string;
}

export const BUILT_IN_PLATFORMS: readonly BuiltInPlatform[] = [
  { id: 'a1000000-0000-4000-8000-000000000001', name: 'SorteNaBet', slug: 'sortenabet', tipMinerRoundUuid: '48323e32-3590-4e2f-b6fe-09d5fbc811c9' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'EstrelaBet', slug: 'estrelabet', tipMinerRoundUuid: '48323e32-3590-4e2f-b6fe-09d5fbc811c9' },
  { id: 'a1000000-0000-4000-8000-000000000003', name: 'APOSTAMAX', slug: 'apostamax', tipMinerRoundUuid: '48323e32-3590-4e2f-b6fe-09d5fbc811c9' },
  { id: 'a1000000-0000-4000-8000-000000000004', name: 'ApostaOnline', slug: 'apostaonline', tipMinerRoundUuid: '48323e32-3590-4e2f-b6fe-09d5fbc811c9' },
  { id: 'a1000000-0000-4000-8000-000000000005', name: 'ApostaTudo', slug: 'apostatudo', tipMinerRoundUuid: '48323e32-3590-4e2f-b6fe-09d5fbc811c9' },
  { id: 'a1000000-0000-4000-8000-000000000006', name: 'Brabet', slug: 'brabet', tipMinerRoundUuid: '48323e32-3590-4e2f-b6fe-09d5fbc811c9' },
  { id: 'a1000000-0000-4000-8000-000000000007', name: 'Esportes da Sorte', slug: 'esportes-da-sorte', tipMinerRoundUuid: '48323e32-3590-4e2f-b6fe-09d5fbc811c9' },
  { id: 'a1000000-0000-4000-8000-000000000008', name: 'VBet', slug: 'vbet', tipMinerRoundUuid: '48323e32-3590-4e2f-b6fe-09d5fbc811c9' },
  { id: 'a1000000-0000-4000-8000-000000000009', name: 'Betou', slug: 'betou', tipMinerRoundUuid: '997b99e3-4977-4fcf-ac6d-3834a384d141' },
  { id: 'a1000000-0000-4000-8000-000000000010', name: 'BetFusion', slug: 'betfusion', tipMinerRoundUuid: '997b99e3-4977-4fcf-ac6d-3834a384d141' },
  { id: 'a1000000-0000-4000-8000-000000000011', name: 'ApostaGanha', slug: 'apostaganha', tipMinerRoundUuid: '997b99e3-4977-4fcf-ac6d-3834a384d141' },
  { id: 'a1000000-0000-4000-8000-000000000012', name: 'Betfair', slug: 'betfair', tipMinerRoundUuid: 'b72e7e9f-7a68-4d2d-b6b7-e67c3ba6c323' },
  { id: 'a1000000-0000-4000-8000-000000000013', name: 'Betnacional', slug: 'betnacional', tipMinerRoundUuid: 'b72e7e9f-7a68-4d2d-b6b7-e67c3ba6c323' },
  { id: 'a1000000-0000-4000-8000-000000000014', name: 'Blaze', slug: 'blaze', tipMinerRoundUuid: 'b72e7e9f-7a68-4d2d-b6b7-e67c3ba6c323' },
  { id: 'a1000000-0000-4000-8000-000000000015', name: 'Jonbet', slug: 'jonbet', tipMinerRoundUuid: 'b72e7e9f-7a68-4d2d-b6b7-e67c3ba6c323' },
  { id: 'a1000000-0000-4000-8000-000000000016', name: 'BravoBet', slug: 'bravobet', tipMinerRoundUuid: 'dddfce2b-42dc-4fd5-afd8-a5ee0ef36f89' }
];
