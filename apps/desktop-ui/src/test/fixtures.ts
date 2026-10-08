import type { FamilyDto } from "../types";

export function family(id: string): FamilyDto {
  return {
    id, displayName: `字体 ${id}`, matchedFaceIds: [id], isFavorite: false, isCollectionMember: false, collectionIds: [], isVariable: false,
    faces: [{ id, identityId: id, styleName: "Regular", postscriptName: null, format: "TrueType", isVariable: false, weight: 400, width: 1,
      variableAxes: [], namedInstances: [], sources: [], location: {state:"excluded",localAvailable:true,cloudAvailable:false,cloudConfirmedAtMs:null,metadataComplete:true,files:[]} }],
  };
}

export function packet(coverage: [number, number][] = [[32, 126]], sample = "Aa") {
  const metadata = new TextEncoder().encode(JSON.stringify({ coverage, sample }));
  const buffer = new ArrayBuffer(4 + metadata.byteLength + 4);
  new DataView(buffer).setUint32(0, metadata.byteLength, true);
  new Uint8Array(buffer, 4, metadata.byteLength).set(metadata);
  new Uint8Array(buffer, 4 + metadata.byteLength).set([0, 1, 0, 0]);
  return buffer;
}
