import { Platform, Text as RNText, type TextProps as RNTextProps } from 'react-native'
import { font } from '../theme/tokens'

export interface TextProps extends RNTextProps {
  className?: string
}

const MappedText = RNText

export const Text = ({ className, ...props }: TextProps) => {
  return (
    <MappedText
      {...props}
      className={className}
      style={[{ fontFamily: Platform.OS === 'web' ? font.sans : undefined }, props.style]}
    />
  )
}
