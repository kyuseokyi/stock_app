// 테스트 전용 — expo-secure-store·expo-file-system 를 메모리 Map 으로 흉내 낸다.
// 사용: jest.mock('expo-secure-store', () => require('./__fixtures__/fake-storage').secureStoreMock)
//       jest.mock('expo-file-system', () => require('./__fixtures__/fake-storage').fileSystemMock)
export const secureMem = new Map<string, string>();
export const fileMem = new Map<string, string>();

export const secureStoreMock = {
  getItemAsync: async (k: string) => secureMem.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => {
    secureMem.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    secureMem.delete(k);
  },
};

class FakeFile {
  private readonly name: string;
  constructor(_dir: unknown, name: string) {
    this.name = name;
  }
  get exists(): boolean {
    return fileMem.has(this.name);
  }
  create(): void {
    if (!fileMem.has(this.name)) fileMem.set(this.name, '');
  }
  write(s: string): void {
    fileMem.set(this.name, s);
  }
  async text(): Promise<string> {
    const v = fileMem.get(this.name);
    if (v === undefined) throw new Error('no file');
    return v;
  }
  delete(): void {
    fileMem.delete(this.name);
  }
}

export const fileSystemMock = { File: FakeFile, Paths: { document: 'doc' } };

export function resetFakeStorage(): void {
  secureMem.clear();
  fileMem.clear();
}
