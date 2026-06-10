/**
 * ServiceIcon - Display Azure service icons
 * Handles both SVG icon paths and emoji fallback
 */

import React from 'react';

const ServiceIcon = ({ icon, alt = 'Service icon', size = 'md' }) => {
  // Size mappings
  const sizeClasses = {
    xs: 'w-4 h-4',
    sm: 'w-5 h-5',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
    xl: 'w-10 h-10',
    '2xl': 'w-12 h-12',
  };
  
  const sizeClass = sizeClasses[size] || sizeClasses.md;
  
  // If icon starts with /icons/, it's an SVG path
  if (icon && icon.startsWith('/icons/')) {
    return (
      <img 
        src={icon} 
        alt={alt} 
        className={`${sizeClass} object-contain`}
      />
    );
  }
  
  // Otherwise it's an emoji or text
  return <span className={`${sizeClass} flex items-center justify-center`}>{icon}</span>;
};

export default ServiceIcon;
