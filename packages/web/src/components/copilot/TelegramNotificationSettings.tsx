"use client";
import { ChannelNotificationSettings } from './ChannelNotificationSettings';

interface Props {available:boolean}
export function TelegramNotificationSettings({available}:Props) {
  return <ChannelNotificationSettings channel="telegram" available={available} />;
}
