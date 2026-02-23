import { useState, useEffect, useCallback } from "react";
import {
  Slider,
  NumberInput,
  Text,
  Stack,
  Group,
  Switch,
  ScrollArea,
  Box,
  UnstyledButton,
  Badge,
} from "@mantine/core";
import type { PicnicTable, UpdateTablePayload } from "../../types";

interface TablePanelProps {
  tables: PicnicTable[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onLiveChange: (updates: UpdateTablePayload) => void;
  onCommit: (updates: UpdateTablePayload) => void;
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  precision,
  onChange,
  onChangeEnd,
  color,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  precision?: number;
  onChange: (v: number) => void;
  onChangeEnd: (v: number) => void;
  color?: string;
}) {
  return (
    <Box>
      <Group justify="space-between" mb={2}>
        <Text size="xs" c="dimmed" fw={600} tt="uppercase" lts="0.05em">
          {label}
        </Text>
        <NumberInput
          size="xs"
          value={value}
          onChange={(v) => {
            const n = typeof v === "number" ? v : parseFloat(v) || 0;
            onChange(n);
            onChangeEnd(n);
          }}
          step={step}
          decimalScale={precision ?? 6}
          min={min}
          max={max}
          hideControls
          styles={{
            input: {
              width: 90,
              textAlign: "right",
              fontFamily: "inherit",
              fontSize: 12,
            },
          }}
        />
      </Group>
      <Slider
        value={value}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
        min={min}
        max={max}
        step={step}
        size="sm"
        color={color}
        label={(v) => v.toFixed(precision ?? 6)}
      />
    </Box>
  );
}

export default function TablePanel({
  tables,
  selectedId,
  onSelect,
  onLiveChange,
  onCommit,
}: TablePanelProps) {
  const selected = tables.find((t) => t.id === selectedId) ?? null;
  const isPlaced = selected?.longitude != null && selected?.latitude != null;

  const [lngOffset, setLngOffset] = useState(0);
  const [latOffset, setLatOffset] = useState(0);
  const [uniformScale, setUniformScale] = useState(true);

  const [lastClickLng, setLastClickLng] = useState<number | null>(null);
  const [lastClickLat, setLastClickLat] = useState<number | null>(null);

  useEffect(() => {
    if (!selected) return;
    if (
      selected.longitude !== lastClickLng ||
      selected.latitude !== lastClickLat
    ) {
      setLngOffset(0);
      setLatOffset(0);
      setLastClickLng(selected.longitude);
      setLastClickLat(selected.latitude);
    }
  }, [selected?.id, selected?.longitude, selected?.latitude]);

  const livePos = useCallback(
    (field: "longitude" | "latitude", offset: number) => {
      if (!selected || selected.longitude == null || selected.latitude == null)
        return;
      const base =
        field === "longitude"
          ? (lastClickLng ?? selected.longitude)
          : (lastClickLat ?? selected.latitude);
      onLiveChange({ [field]: base + offset });
    },
    [selected, lastClickLng, lastClickLat, onLiveChange]
  );

  const commitPos = useCallback(
    (field: "longitude" | "latitude", offset: number) => {
      if (!selected || selected.longitude == null || selected.latitude == null)
        return;
      const base =
        field === "longitude"
          ? (lastClickLng ?? selected.longitude)
          : (lastClickLat ?? selected.latitude);
      onCommit({ [field]: base + offset });
    },
    [selected, lastClickLng, lastClickLat, onCommit]
  );

  const handleScaleChange = useCallback(
    (axis: "scale_x" | "scale_y" | "scale_z", value: number) => {
      if (uniformScale) {
        onLiveChange({ scale_x: value, scale_y: value, scale_z: value });
      } else {
        onLiveChange({ [axis]: value });
      }
    },
    [uniformScale, onLiveChange]
  );

  const handleScaleCommit = useCallback(
    (axis: "scale_x" | "scale_y" | "scale_z", value: number) => {
      if (uniformScale) {
        onCommit({ scale_x: value, scale_y: value, scale_z: value });
      } else {
        onCommit({ [axis]: value });
      }
    },
    [uniformScale, onCommit]
  );

  const scaleVal = uniformScale
    ? (selected?.scale_x ?? 1)
    : undefined;

  return (
    <Box
      style={{
        width: 340,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--mantine-color-dark-5)",
        background: "var(--mantine-color-dark-8)",
      }}
    >
      <Group justify="space-between" p="sm" pb="xs" style={{ flexShrink: 0 }}>
        <Text size="sm" fw={700} tt="uppercase" lts="0.04em" c="dimmed">
          Picnic Tables
        </Text>
        <Badge size="sm" variant="light" color="gray">
          {tables.length}
        </Badge>
      </Group>

      <ScrollArea h={240} style={{ flexShrink: 0, borderBottom: "1px solid var(--mantine-color-dark-5)" }}>
        {tables.map((t) => {
          const placed = t.longitude != null && t.latitude != null;
          const isSel = t.id === selectedId;
          return (
            <UnstyledButton
              key={t.id}
              onClick={() => onSelect(t.id)}
              w="100%"
              px="sm"
              py={6}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: isSel
                  ? "var(--mantine-color-blue-9)"
                  : "transparent",
                borderRadius: 0,
              }}
            >
              <Text size="sm" c={isSel ? "white" : "gray.3"} truncate>
                {t.name}
              </Text>
              <Box
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: placed
                    ? "var(--mantine-color-green-5)"
                    : "var(--mantine-color-dark-4)",
                  flexShrink: 0,
                }}
              />
            </UnstyledButton>
          );
        })}
      </ScrollArea>

      {selected && (
        <ScrollArea flex={1} p="sm" offsetScrollbars>
          <Stack gap="md">
            <Group justify="space-between" align="baseline">
              <Text size="md" fw={700} c="gray.1">
                {selected.name}
              </Text>
              {!isPlaced && (
                <Text size="xs" fs="italic" c="dimmed">
                  Click map to place
                </Text>
              )}
            </Group>

            {isPlaced && (
              <Stack gap="xs">
                <Text size="xs" fw={700} tt="uppercase" lts="0.06em" c="dimmed">
                  Position
                </Text>
                <Group gap="lg">
                  <Box>
                    <Text size="xs" c="dimmed">Lng</Text>
                    <Text size="sm" ff="monospace">{selected.longitude!.toFixed(6)}</Text>
                  </Box>
                  <Box>
                    <Text size="xs" c="dimmed">Lat</Text>
                    <Text size="sm" ff="monospace">{selected.latitude!.toFixed(6)}</Text>
                  </Box>
                </Group>
                <SliderField label="Fine-tune Lng" value={lngOffset} min={-0.001} max={0.001} step={0.000001} precision={6} color="red"
                  onChange={(v) => { setLngOffset(v); livePos("longitude", v); }}
                  onChangeEnd={(v) => { setLngOffset(v); commitPos("longitude", v); }}
                />
                <SliderField label="Fine-tune Lat" value={latOffset} min={-0.001} max={0.001} step={0.000001} precision={6} color="green"
                  onChange={(v) => { setLatOffset(v); livePos("latitude", v); }}
                  onChangeEnd={(v) => { setLatOffset(v); commitPos("latitude", v); }}
                />
                <SliderField label="Altitude (m)" value={selected.altitude} min={-5} max={20} step={0.1} precision={1} color="blue"
                  onChange={(v) => onLiveChange({ altitude: v })}
                  onChangeEnd={(v) => onCommit({ altitude: v })}
                />
              </Stack>
            )}

            <Stack gap="xs">
              <Text size="xs" fw={700} tt="uppercase" lts="0.06em" c="dimmed">Rotation (deg)</Text>
              <SliderField label="X (pitch)" value={selected.rotation_x} min={-180} max={180} step={0.1} precision={1} color="red"
                onChange={(v) => onLiveChange({ rotation_x: v })} onChangeEnd={(v) => onCommit({ rotation_x: v })} />
              <SliderField label="Y (yaw)" value={selected.rotation_y} min={-180} max={180} step={0.1} precision={1} color="green"
                onChange={(v) => onLiveChange({ rotation_y: v })} onChangeEnd={(v) => onCommit({ rotation_y: v })} />
              <SliderField label="Z (roll)" value={selected.rotation_z} min={-180} max={180} step={0.1} precision={1} color="blue"
                onChange={(v) => onLiveChange({ rotation_z: v })} onChangeEnd={(v) => onCommit({ rotation_z: v })} />
            </Stack>

            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="xs" fw={700} tt="uppercase" lts="0.06em" c="dimmed">Scale</Text>
                <Switch label="Uniform" size="xs" checked={uniformScale} onChange={(e) => setUniformScale(e.currentTarget.checked)} />
              </Group>
              {uniformScale ? (
                <SliderField label="XYZ" value={scaleVal!} min={0.01} max={5} step={0.01} precision={2} color="yellow"
                  onChange={(v) => handleScaleChange("scale_x", v)} onChangeEnd={(v) => handleScaleCommit("scale_x", v)} />
              ) : (
                <>
                  <SliderField label="X" value={selected.scale_x} min={0.01} max={5} step={0.01} precision={2} color="red"
                    onChange={(v) => handleScaleChange("scale_x", v)} onChangeEnd={(v) => handleScaleCommit("scale_x", v)} />
                  <SliderField label="Y" value={selected.scale_y} min={0.01} max={5} step={0.01} precision={2} color="green"
                    onChange={(v) => handleScaleChange("scale_y", v)} onChangeEnd={(v) => handleScaleCommit("scale_y", v)} />
                  <SliderField label="Z" value={selected.scale_z} min={0.01} max={5} step={0.01} precision={2} color="blue"
                    onChange={(v) => handleScaleChange("scale_z", v)} onChangeEnd={(v) => handleScaleCommit("scale_z", v)} />
                </>
              )}
            </Stack>
          </Stack>
        </ScrollArea>
      )}
    </Box>
  );
}
