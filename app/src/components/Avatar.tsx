interface AvatarProps {
  photoUrl: string | null;
  name: string;
  size?: number;
}

/**
 * 子供の顔写真アバター(要件定義書5.5章: 絵文字アイコンではなく実際の写真を表示する)。
 * 未設定時はプレースホルダーを表示する。
 */
export function Avatar({ photoUrl, name, size = 56 }: AvatarProps) {
  if (photoUrl) {
    return (
      <img
        className="avatar"
        src={photoUrl}
        alt={name}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="avatar-placeholder"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      aria-label={name}
    >
      👤
    </span>
  );
}
