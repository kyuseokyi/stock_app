import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export type PickerOption<T> = { value: T; label: string };

type Props<T> = {
  /** 선택 리스트 상단 제목(예: '비중', '손절') */
  title: string;
  options: readonly PickerOption<T>[];
  /** 현재 값 — options 에 없으면 placeholder 표시 */
  value: T;
  placeholder: string;
  /** 칩처럼 강조할지(값이 선택된 상태) */
  active: boolean;
  onChange: (value: T) => void;
};

/**
 * RN 에는 네이티브 select 가 없어 칩 모양 트리거("라벨 ▾") → 투명 Modal 의 경량 선택 리스트로 대신한다.
 * 비중 기타·손절·익절에 공용. Android 뒤로가기는 onRequestClose 로 닫힘. 스타일은 RN 기본 컴포넌트에만(Unistyles).
 */
export function OptionPicker<T>({ title, options, value, placeholder, active, onChange }: Props<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  const close = () => setOpen(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${title} 선택`}
        style={[styles.trigger, active && styles.triggerOn]}>
        <Text style={[styles.triggerLabel, active && styles.triggerLabelOn]}>{`${current ? current.label : placeholder} ▾`}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.center}>
          {/* 배경 탭 → 닫기. 패널과 형제로 두어 패널 내부 탭이 닫기로 새지 않게 */}
          <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="닫기" />
          <View style={styles.panel}>
            <Text style={styles.title}>{title}</Text>
            <ScrollView>
              {options.map((o) => {
                const selected = o.value === value;
                return (
                  <Pressable
                    key={o.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      onChange(o.value);
                      close();
                    }}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
                    <Text style={[styles.rowLabel, selected && styles.rowLabelOn]}>{o.label}</Text>
                    {selected ? <Text style={styles.check}>✓</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    borderRadius: theme.radius.chip,
    paddingVertical: theme.gap(0.75),
    paddingHorizontal: theme.gap(1.5),
    backgroundColor: theme.colors.surface,
  },
  triggerOn: { backgroundColor: theme.colors.primarySoft },
  triggerLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.textSecondary },
  triggerLabelOn: { color: theme.colors.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.gap(3) },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  panel: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '70%',
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.background,
    paddingVertical: theme.gap(1.5),
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
    paddingHorizontal: theme.gap(2.5),
    paddingBottom: theme.gap(1),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.gap(2.5),
    paddingVertical: theme.gap(1.5),
  },
  rowPressed: { backgroundColor: theme.colors.surface },
  rowLabel: { fontSize: 16, color: theme.colors.text },
  rowLabelOn: { color: theme.colors.primary, fontWeight: '700' },
  check: { fontSize: 16, fontWeight: '700', color: theme.colors.primary },
}));
